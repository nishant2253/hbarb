/**
 * agentRunner.ts — AI + Algorithmic trading agent cycle
 *
 * The core trading loop for TradeAgent:
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  1. Fetch price from Pyth oracle (via Agent Kit)            │
 *   │  2a. Compute full indicator set (EMA/RSI/MACD/Bollinger/ATR)│
 *   │  2b. Run deterministic strategy → signal + confidence       │
 *   │  2c. Gemini enriches reasoning text (not the signal)        │
 *   │  3. HCS write ← ALWAYS before trade execution ⚠️           │
 *   │  4. Execute swap via MockDEX / SaucerSwap                   │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * THE CRITICAL INVARIANT:
 *   HCS message MUST be submitted BEFORE any swap call.
 *   The aBFT consensus timestamp proves the decision came first.
 */

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage } from '@langchain/core/messages';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ethers } from 'ethers';
import { submitAgentDecision, getOperatorKey, createHederaClient } from '@tradeagent/hedera';
import { createAgentKit, getPythPrice } from './hederaKit';
import { executeTradeSignal } from './tradeExecutor';
import type { AgentConfig } from './promptBuilder';
import { calculateAllIndicators, pricesToOHLCV } from './indicators';
import { runStrategy } from './strategies';
import { calculatePositionSize as kellyPositionSize, DEFAULT_RISK_CONFIG } from './riskManager';
import prisma from '../db/prisma';

// ── SaucerSwap Price ──────────────────────────────────────────────

/**
 * Fetch the live HBAR/USDC price from SaucerSwap DEX.
 * Uses the SaucerSwap public REST API — no key required.
 * Returns null on failure so callers can fall back to Pyth.
 */
async function fetchSaucerSwapPrice(): Promise<number | null> {
  try {
    // SaucerSwap v2 tokens endpoint — HBAR is token 0 (native)
    const res = await fetch('https://api.saucerswap.finance/tokens/', { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const tokens = await res.json() as Array<{ symbol: string; priceUsd: string }>;
    const hbarToken = tokens.find(t => t.symbol === 'HBAR' || t.symbol === 'WHBAR');
    if (!hbarToken?.priceUsd) return null;
    const price = parseFloat(hbarToken.priceUsd);
    return isNaN(price) || price <= 0 ? null : price;
  } catch {
    return null;
  }
}

// ── MockDEX reserve sync ──────────────────────────────────────────

const MOCK_DEX_RESERVE_ABI = [
  "function refreshReserves(uint256 newHBAR, uint256 newUSDC) external",
];

/**
 * Sync MockDEX pool reserves to reflect the current market price.
 * Called after each price fetch so getSwapQuote() returns accurate values.
 */
async function syncMockDexReserves(priceUSD: number): Promise<void> {
  const mockDexAddr = process.env.MOCK_DEX_ADDRESS;
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY;
  if (!mockDexAddr || !operatorKey) return;

  try {
    const provider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api');
    const wallet   = new ethers.Wallet(operatorKey, provider);
    const mockDex  = new ethers.Contract(mockDexAddr, MOCK_DEX_RESERVE_ABI, wallet);

    // Keep pool balanced at ~500K HBAR with USDC reserves matching current price
    const hbarReserveTinybars = BigInt(500_000) * BigInt(100_000_000);
    const usdcReserveMicro    = BigInt(Math.round(priceUSD * 500_000 * 1_000_000));

    await mockDex.refreshReserves(hbarReserveTinybars, usdcReserveMicro, {
      gasLimit: 100_000,
      gasPrice: ethers.parseUnits('1200', 'gwei'),
    });
    console.log(`[MockDEX] Pool synced: $${priceUSD.toFixed(4)}/HBAR`);
  } catch (err) {
    // Non-fatal — trading can still continue with stale reserves
    console.warn('[MockDEX] Reserve sync skipped:', (err as Error).message?.slice(0, 80));
  }
}

// ── Types ─────────────────────────────────────────────────────────

export interface AgentCycleResult {
  decision:     TradingDecision;
  hcsResult:    { sequenceNumber: string; consensusTimestamp: string; topicId: string };
  swapExecuted: boolean;
  tradeResult:  { txHash?: string; fillPrice?: number; slippageBps?: number } | null;
  cycleMs:      number;
}

export interface TradingDecision {
  signal:     'BUY' | 'SELL' | 'HOLD';
  confidence: number;         // 0–100
  reasoning:  string;
  price:      number;
  indicators: Record<string, number>;
}

// ── Price history helpers ─────────────────────────────────────────

const ASSET_SYMBOL_MAP: Record<string, string> = {
  'HBAR/USDC': 'HBARUSDT',
  'HBAR/USDT': 'HBARUSDT',
  'HBAR/USD':  'HBARUSDT',
  'BTC/USD':   'BTCUSDT',
  'BTC/USDT':  'BTCUSDT',
  'ETH/USD':   'ETHUSDT',
  'ETH/USDT':  'ETHUSDT',
};

function assetToSymbol(asset: string): string {
  const upper = asset.toUpperCase();
  return ASSET_SYMBOL_MAP[upper]
    ?? Object.entries(ASSET_SYMBOL_MAP).find(([k]) => upper.startsWith(k.split('/')[0]))?.[1]
    ?? 'HBARUSDT';
}

/** Fetch OHLCV candles from Binance klines endpoint */
async function fetchOHLCV(asset: string, limit: number): Promise<Array<{open:number;high:number;low:number;close:number;volume:number;timestamp:number}>> {
  const symbol  = assetToSymbol(asset);
  const url     = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=${limit}`;
  const res     = await fetch(url);
  if (!res.ok) throw new Error(`Binance API ${res.status}`);
  const candles = await res.json() as unknown[][];
  return candles.map(c => ({
    timestamp: Number(c[0]),
    open:      parseFloat(String(c[1])),
    high:      parseFloat(String(c[2])),
    low:       parseFloat(String(c[3])),
    close:     parseFloat(String(c[4])),
    volume:    parseFloat(String(c[5])),
  }));
}

async function fetchPriceHistory(asset: string, limit: number): Promise<number[]> {
  const candles = await fetchOHLCV(asset, limit);
  return candles.map(c => c.close);
}

// ── runAgentCycle ─────────────────────────────────────────────────

/**
 * Runs one complete agent decision cycle.
 *
 * ⚠️  INVARIANT: HCS write happens in Step 3, BEFORE Step 4 (swap).
 *     This is enforced in code — the swap block gates on hcsResult.
 *
 * @param agentConfig - Full validated config from promptBuilder
 * @param hcsTopicId  - Agent's dedicated HCS topic ("0.0.XXXXX")
 * @param dryRun      - If true, skip the actual SaucerSwap execution
 */
export async function runAgentCycle(
  agentConfig: AgentConfig & { agentId: string },
  hcsTopicId: string,
  dryRun = false
): Promise<AgentCycleResult> {
  const cycleStart = Date.now();

  console.log(`\n[AgentRunner] ═══════════════════════════════════`);
  console.log(`[AgentRunner] Starting cycle for: ${agentConfig.name}`);
  console.log(`[AgentRunner] Strategy: ${agentConfig.strategyType} | ${agentConfig.asset} | ${agentConfig.timeframe}`);
  console.log(`[AgentRunner] HCS Topic: ${hcsTopicId} | DryRun: ${dryRun}`);
  console.log(`[AgentRunner] ═══════════════════════════════════\n`);

  // ── Step 1: Initialize LangGraph + Hedera Agent Kit ───────────
  console.log('[AgentRunner] Step 1: Initializing Agent Kit...');
  const { toolkit, tools, client } = createAgentKit();

  const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const llm = new ChatGoogleGenerativeAI({
    model:       GEMINI_MODEL,
    temperature: 0.1,
    apiKey:      process.env.GEMINI_API_KEY,
  });

  const agent = createReactAgent({ llm, tools });

  // ── Step 2: Fetch price data from Pyth ───────────────────────
  console.log(`[AgentRunner] Step 2: Fetching ${agentConfig.asset} price from Pyth...`);

  let price: number | null = null;

  // Try via Agent Kit LangGraph (Pyth tool)
  try {
    const priceResult = await agent.invoke({
      messages: [
        new HumanMessage(
          `Get the current ${agentConfig.asset} price from Pyth oracle. Return ONLY the numeric price value.`
        ),
      ],
    });

    const msgs = priceResult.messages ?? [];
    const lastMsg = msgs[msgs.length - 1];
    const content = typeof lastMsg?.content === 'string'
      ? lastMsg.content
      : JSON.stringify(lastMsg?.content ?? '');

    const priceMatch = content.match(/[\d]+\.[\d]+/);
    if (priceMatch) {
      price = parseFloat(priceMatch[0]);
    }
  } catch (err) {
    console.warn('[AgentRunner] Agent Kit price fetch failed, using direct Pyth API...');
  }

  // Fallback: direct Pyth Hermes API
  if (!price || isNaN(price)) {
    price = await getPythPrice(agentConfig.asset);
  }

  if (!price) {
    throw new Error(`Failed to fetch ${agentConfig.asset} price from Pyth + fallbacks`);
  }

  // ── Cross-check with SaucerSwap DEX price ─────────────────────
  const saucerPrice = await fetchSaucerSwapPrice();
  if (saucerPrice) {
    const deviation = Math.abs(price - saucerPrice) / price;
    console.log(`[HederaKit] Pyth price for ${agentConfig.asset}: $${price}`);
    console.log(`[SaucerSwap] DEX market price: $${saucerPrice.toFixed(6)}`);
    if (deviation > 0.05) {
      // More than 5% divergence — use SaucerSwap as it's the on-chain DEX
      console.warn(`[AgentRunner] Pyth/SaucerSwap divergence ${(deviation * 100).toFixed(1)}% — using SaucerSwap`);
      price = saucerPrice;
    }
  }

  console.log(`[AgentRunner] Price: $${price.toFixed(6)}`);

  // Sync MockDEX reserves so getSwapQuote() returns accurate prices
  if (process.env.HEDERA_NETWORK === 'testnet') {
    await syncMockDexReserves(price);
  }

  // ── Step 2b: Compute full indicator set ─────────────────────────
  console.log('[AgentRunner] Step 2b: Computing technical indicators...');
  const fastPeriod = agentConfig.indicators?.movingAverage?.period ?? 20;
  const slowPeriod = Math.max(fastPeriod * 3, 60);
  const rsiPeriod  = agentConfig.indicators?.rsi?.period ?? 14;
  // Need at least slow+MACD(26+9)+buffer candles
  const neededBars = Math.max(slowPeriod + 40, 80);

  let indicatorResult: ReturnType<typeof calculateAllIndicators> | null = null;
  let computedIndicators: Record<string, number> = { price };

  try {
    const ohlcv = await fetchOHLCV(agentConfig.asset, neededBars);
    // Append current price as a synthetic candle to include the live tick
    const syntheticCandle = {
      open: price, high: price, low: price, close: price,
      volume: ohlcv[ohlcv.length - 1]?.volume ?? 1,
      timestamp: Date.now(),
    };
    const allOHLCV = [...ohlcv, syntheticCandle];

    indicatorResult = calculateAllIndicators(allOHLCV, {
      fastEMA:   fastPeriod,
      slowEMA:   slowPeriod,
      rsiPeriod,
    });

    computedIndicators = {
      price,
      fastEMA:        parseFloat(indicatorResult.ema.fast.toFixed(6)),
      slowEMA:        parseFloat(indicatorResult.ema.slow.toFixed(6)),
      [`RSI_${rsiPeriod}`]: parseFloat(indicatorResult.rsi.value.toFixed(2)),
      MACD_line:      parseFloat(indicatorResult.macd.macdLine.toFixed(6)),
      MACD_histogram: parseFloat(indicatorResult.macd.histogram.toFixed(6)),
      boll_upper:     parseFloat(indicatorResult.bollinger.upper.toFixed(6)),
      boll_lower:     parseFloat(indicatorResult.bollinger.lower.toFixed(6)),
      ATR:            parseFloat(indicatorResult.atr.value.toFixed(6)),
      compositeScore: indicatorResult.compositeScore,
    };
    console.log(`[AgentRunner] Indicators: EMA(${indicatorResult.ema.signal}) RSI=${indicatorResult.rsi.value.toFixed(1)} MACD(${indicatorResult.macd.signal}) Score=${indicatorResult.compositeScore}`);
  } catch (err) {
    console.warn('[AgentRunner] Indicator computation failed — using price only:', (err as Error).message);
  }

  // ── Step 2c: Run deterministic strategy → signal + confidence ───
  console.log('[AgentRunner] Step 2c: Running strategy...');
  const riskConfig = {
    stopLossPct:   agentConfig.risk?.stopLossPct   ?? DEFAULT_RISK_CONFIG.stopLossPct,
    takeProfitPct: agentConfig.risk?.takeProfitPct ?? DEFAULT_RISK_CONFIG.takeProfitPct,
  };

  let strategyOutput = { signal: 'HOLD' as 'BUY'|'SELL'|'HOLD', confidence: 50, reasoning: 'Indicator data unavailable.' };
  if (indicatorResult) {
    const out = runStrategy(agentConfig.strategyType, indicatorResult, price, riskConfig);
    strategyOutput = { signal: out.signal, confidence: out.confidence, reasoning: out.reasoning };
    console.log(`[AgentRunner] Strategy output: ${out.signal} (${out.confidence}%) — ${out.reasoning}`);
  }

  // ── Step 3: Gemini enriches the reasoning (signal already decided) ──
  console.log('[AgentRunner] Step 3: Gemini enriching reasoning...');
  let reasoning = strategyOutput.reasoning;
  try {
    const genAI        = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const reasonModel  = genAI.getGenerativeModel({
      model:            GEMINI_MODEL,
      generationConfig: { temperature: 0.3 },
    });
    const enrichPrompt =
      `You are a quantitative trading analyst. The algorithmic strategy produced this trade signal:\n` +
      `Signal: ${strategyOutput.signal} | Confidence: ${strategyOutput.confidence}%\n` +
      `Strategy reasoning: ${strategyOutput.reasoning}\n` +
      `Asset: ${agentConfig.asset} | Price: $${price} | Strategy: ${agentConfig.strategyType}\n` +
      `Indicators: compositeScore=${computedIndicators.compositeScore}, ` +
      `RSI=${computedIndicators[`RSI_${rsiPeriod}`]}, ` +
      `EMA_fast=${computedIndicators.fastEMA}, EMA_slow=${computedIndicators.slowEMA}\n\n` +
      `Write ONE concise sentence (max 120 chars) explaining the trade rationale, citing actual indicator values. ` +
      `Do NOT change the signal. Plain text only, no JSON.`;
    const enrichRaw = await reasonModel.generateContent(enrichPrompt);
    const enriched  = enrichRaw.response.text().trim().replace(/\n+/g, ' ').slice(0, 200);
    if (enriched.length > 20) reasoning = enriched;
  } catch (err) {
    console.warn('[AgentRunner] Gemini reasoning enrichment failed:', (err as Error).message?.slice(0, 60));
  }

  const decision: TradingDecision = {
    signal:     strategyOutput.signal,
    confidence: strategyOutput.confidence,
    reasoning,
    price,
    indicators: computedIndicators,
  };

  console.log(`[AgentRunner] Decision: ${decision.signal} (confidence: ${decision.confidence}%) — ${decision.reasoning}`);

  // ── Step 4: executeTradeSignal (handles HCS + Execution + HCS Result)
  console.log(`\n[AgentRunner] Step 4: Routing to tradeExecutor...`);
  
  const amountTinybars = await calculatePositionSize(
    agentConfig.risk?.maxPositionSizePct ?? 5,
    price,
    agentConfig.agentId,
    decision.confidence,
  );

  const { hcsResult, tradeResult, mode } = await executeTradeSignal({
    signal: decision.signal,
    asset: agentConfig.asset,
    amountTinybars,
    agentId: agentConfig.agentId,
    hcsTopicId,
    confidence: decision.confidence,
    reasoning: decision.reasoning,
    price,
    indicators: decision.indicators,
    hederaClient: client,
    dryRun,
  });

  const cycleMs = Date.now() - cycleStart;

  console.log(`\n[AgentRunner] ═══════════════════════════════════`);
  console.log(`[AgentRunner] Cycle complete in ${cycleMs}ms`);
  console.log(`[AgentRunner] Mode: ${mode}`);
  console.log(`[AgentRunner] HCS seq: #${hcsResult.sequenceNumber}`);
  console.log(`[AgentRunner] Swap Executed: ${!!tradeResult}`);
  console.log(`[AgentRunner] ═══════════════════════════════════\n`);

  client.close();

  return { 
    decision, 
    hcsResult:    { ...hcsResult, topicId: hcsTopicId }, 
    swapExecuted: !!tradeResult,
    tradeResult:  tradeResult ?? null,
    cycleMs, 
  };
}

// Calculate how many tinybars to trade using Kelly Criterion sizing.
// Uses historical win rate from DB executions for the specific agent.
async function calculatePositionSize(
  maxPositionPct: number,
  priceUSD:       number,
  agentId?:       string,
  confidence      = 60,
): Promise<bigint> {
  const accountId = process.env.OPERATOR_ACCOUNT_ID!;
  if (!accountId) return 0n;

  const res  = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${accountId}`);
  const data = (await res.json()) as any;
  const balanceTinybars = BigInt(data.balance?.balance ?? 0);

  // Fetch historical win rate from DB for this agent
  let historicalWinRate = 0.50;
  if (agentId) {
    try {
      const execs = await prisma.execution.findMany({
        where:  { agentId, signal: { in: ['BUY', 'SELL'] } },
        select: { fillPrice: true, signal: true },
        orderBy: { createdAt: 'desc' },
        take:   50,
      });
      if (execs.length >= 5) {
        // Simple proxy: assume win if fill price exists (actual P&L requires exit price)
        const withFill = execs.filter(e => e.fillPrice != null).length;
        historicalWinRate = withFill / execs.length;
      }
    } catch { /* ignore — use default */ }
  }

  return kellyPositionSize(
    balanceTinybars,
    confidence,
    { maxPositionSizePct: Math.min(maxPositionPct, 20) },
    historicalWinRate,
    2.0, // default R:R ratio
  );
}

// ── extractPrice (utility used by agentRunner internally) ─────────

/**
 * Extracts a numeric price from an LLM response string.
 * Handles various formats: "$0.0842", "0.0842 USD", "Price: 0.0842"
 */
export function extractPrice(responseContent: string): number | null {
  // Match patterns like: $0.0842, 0.0842, 0.0842 USD, USD 0.0842
  const patterns = [
    /\$?([\d]+\.[\d]{2,8})/,         // $0.0842 or 0.08420
    /price[:\s]+\$?([\d.]+)/i,       // price: 0.0842
    /([\d]+\.[\d]+)\s*USD/i,         // 0.0842 USD
  ];

  for (const pattern of patterns) {
    const match = responseContent.match(pattern);
    if (match) {
      const val = parseFloat(match[1]);
      if (!isNaN(val) && val > 0) return val;
    }
  }
  return null;
}
