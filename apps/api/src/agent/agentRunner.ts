/**
 * agentRunner.ts — LangGraph ReAct agent cycle
 *
 * The core AI trading loop for TradeAgent:
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │  1. Fetch price from Pyth oracle (via Agent Kit)    │
 *   │  2. AI decision: BUY / SELL / HOLD (Gemini Flash)   │
 *   │  3. HCS write ← ALWAYS before trade execution ⚠️   │
 *   │  4. SaucerSwap execution (if BUY or SELL)           │
 *   └─────────────────────────────────────────────────────┘
 *
 * THE CRITICAL INVARIANT:
 *   HCS message MUST be submitted BEFORE any SaucerSwap call.
 *   The aBFT consensus timestamp proves the decision came first.
 *   This is what makes TradeAgent verifiable — not just auditable.
 *
 * Uses LangGraph's createReactAgent() for the tool-calling loop.
 * The LLM uses SaucerSwap + Pyth tools declared in hederaKit.ts.
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

// ── Technical indicator helpers ───────────────────────────────────

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

async function fetchPriceHistory(asset: string, limit: number): Promise<number[]> {
  const symbol  = assetToSymbol(asset);
  const url     = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=${limit}`;
  const res     = await fetch(url);
  if (!res.ok) throw new Error(`Binance API ${res.status}`);
  const candles = await res.json() as unknown[][];
  return candles.map(c => parseFloat(String(c[4]))); // close prices
}

/** Exponential Moving Average — seeds with SMA for the first `period` bars */
function computeEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1];
  const k   = 2 / (period + 1);
  let   ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

/** Relative Strength Index (Wilder's smoothing) */
function computeRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  const recent = prices.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const Δ = recent[i] - recent[i - 1];
    if (Δ > 0) gains  += Δ;
    else        losses += Math.abs(Δ);
  }
  const avgGain = gains  / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
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

    // ── Step 2b: Compute technical indicators from price history ────
  console.log('[AgentRunner] Step 2b: Computing technical indicators...');
  let computedIndicators: Record<string, number> = { price };
  try {
    const neededBars = Math.max(
      (agentConfig.indicators?.movingAverage?.period ?? 0) + 10,
      (agentConfig.indicators?.rsi?.period ?? 14) + 10,
      80
    );
    const priceHistory = await fetchPriceHistory(agentConfig.asset, neededBars);
    const allPrices = [...priceHistory, price];

    if (agentConfig.indicators?.movingAverage) {
      const { type, period } = agentConfig.indicators.movingAverage;
      const val = computeEMA(allPrices, period);
      computedIndicators[`${type}_${period}`] = parseFloat(val.toFixed(6));
      computedIndicators['price_vs_ma_pct'] = parseFloat(((price / val - 1) * 100).toFixed(3));
    }
    if (agentConfig.indicators?.rsi) {
      const { period, overbought, oversold } = agentConfig.indicators.rsi;
      computedIndicators[`RSI_${period}`] = computeRSI(allPrices, period);
      computedIndicators['rsi_overbought'] = overbought;
      computedIndicators['rsi_oversold']   = oversold;
    }
    if (agentConfig.indicators?.macd) {
      const { fast, slow } = agentConfig.indicators.macd;
      const emaFast = computeEMA(allPrices, fast);
      const emaSlow = computeEMA(allPrices, slow);
      computedIndicators['MACD_line'] = parseFloat((emaFast - emaSlow).toFixed(6));
    }
    console.log('[AgentRunner] Indicators:', JSON.stringify(computedIndicators));
  } catch (err) {
    console.warn('[AgentRunner] Indicator computation failed — using price only:', (err as Error).message);
  }

  // ── Step 3: Gemini AI decision ────────────────────────────────
  console.log('[AgentRunner] Step 3: Generating AI trading decision...');

  // Build an indicator summary string for readability in the prompt
  const indicatorSummaryLines = Object.entries(computedIndicators)
    .filter(([k]) => k !== 'price')
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');

  const decisionPrompt = `You are a systematic algorithmic trading agent. Make a decisive BUY, SELL, or HOLD decision.

Strategy: ${agentConfig.strategyType}
Asset: ${agentConfig.asset}
Timeframe: ${agentConfig.timeframe}
Current Price: $${price}

COMPUTED INDICATOR VALUES (use these for your decision):
${indicatorSummaryLines || '  (only spot price available)'}

Risk config: stop-loss ${agentConfig.risk.stopLossPct}%, take-profit ${agentConfig.risk.takeProfitPct}%, max position ${agentConfig.risk.maxPositionSizePct}%

Decision rules for ${agentConfig.strategyType}:
- TREND_FOLLOW: BUY when price > MA and RSI not overbought; SELL when price < MA and RSI not oversold
- MEAN_REVERT: BUY when RSI < oversold level; SELL when RSI > overbought level
- BREAKOUT: BUY when price_vs_ma_pct > 1%; SELL when price_vs_ma_pct < -1%
- MOMENTUM: BUY when RSI > 55 and rising; SELL when RSI < 45 and falling

Apply the rules above with the actual computed values. Do NOT return HOLD just because an indicator value is unexpected — make the most informed decision you can from the data provided.

Return ONLY valid JSON:
{
  "signal": "BUY" | "SELL" | "HOLD",
  "confidence": <number 0-100>,
  "reasoning": "<one sentence citing the actual indicator values>",
  "indicators": ${JSON.stringify(computedIndicators)}
}`;

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const decisionModel = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  });

  const decisionRaw = await decisionModel.generateContent(decisionPrompt);
  const decisionText = decisionRaw.response.text().trim()
    .replace(/^```(?:json)?\n?/i, '')
    .replace(/\n?```$/i, '');

  const rawDecision = JSON.parse(decisionText);
  const decision: TradingDecision = {
    signal:     rawDecision.signal     as 'BUY' | 'SELL' | 'HOLD',
    confidence: rawDecision.confidence as number,
    reasoning:  rawDecision.reasoning  as string,
    price,
    // Prefer Gemini's returned indicators but merge with our computed ones so they're always present
    indicators: { ...computedIndicators, ...(rawDecision.indicators as Record<string, number> ?? {}) },
  };

  console.log(`[AgentRunner] Decision: ${decision.signal} (confidence: ${decision.confidence}%) — ${decision.reasoning}`);

  // ── Step 4: executeTradeSignal (handles HCS + Execution + HCS Result)
  console.log(`\n[AgentRunner] Step 4: Routing to tradeExecutor...`);
  
  const amountTinybars = await calculatePositionSize(
    agentConfig.risk.maxPositionSizePct || 5, // fallback 5%
    price
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

// Calculate how many tinybars to trade based on position size %
async function calculatePositionSize(
  maxPositionPct: number,
  priceUSD: number
): Promise<bigint> {
  const accountId = process.env.OPERATOR_ACCOUNT_ID!;
  if (!accountId) return 0n;
  
  const res = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${accountId}`);
  const data = (await res.json()) as any;
  const balanceTinybars = BigInt(data.balance?.balance ?? 0);
  
  // maxPositionPct % of balance, capped at 20%
  const pct = Math.min(maxPositionPct, 20);
  return (balanceTinybars * BigInt(pct)) / 100n;
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
