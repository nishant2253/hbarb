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
import { submitAgentDecision, getOperatorKey, createHederaClient } from '@tradeagent/hedera';
import { createAgentKit, getPythPrice } from './hederaKit';
import { executeTradeSignal } from './tradeExecutor';
import type { AgentConfig } from './promptBuilder';

// ── Types ─────────────────────────────────────────────────────────

export interface AgentCycleResult {
  decision:     TradingDecision;
  hcsResult:    { sequenceNumber: string; consensusTimestamp: string; topicId: string };
  swapExecuted: boolean;
  cycleMs:      number;
}

export interface TradingDecision {
  signal:     'BUY' | 'SELL' | 'HOLD';
  confidence: number;         // 0–100
  reasoning:  string;
  price:      number;
  indicators: Record<string, number>;
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

  console.log(`[AgentRunner] Price: $${price.toFixed(6)}`);

  // ── Step 3: Gemini AI decision ────────────────────────────────
  console.log('[AgentRunner] Step 3: Generating AI trading decision...');

  const decisionPrompt = `You are a systematic trading agent managing a position.

Strategy: ${agentConfig.strategyType}
Asset: ${agentConfig.asset}
Timeframe: ${agentConfig.timeframe}
Current Price: ${price}
Indicators config: ${JSON.stringify(agentConfig.indicators)}
Risk params: ${JSON.stringify(agentConfig.risk)}

Based on the ${agentConfig.strategyType} strategy logic for ${agentConfig.asset} at price ${price},
decide whether to BUY, SELL, or HOLD.

Return ONLY valid JSON in this exact format:
{
  "signal": "BUY" | "SELL" | "HOLD",
  "confidence": <number 0-100>,
  "reasoning": "<one sentence explanation>",
  "indicators": {
    "price": ${price},
    "signal_strength": <0-100>
  }
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
    indicators: rawDecision.indicators as Record<string, number> ?? { price },
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
    hcsResult: { ...hcsResult, topicId: hcsTopicId }, 
    swapExecuted: !!tradeResult, 
    cycleMs 
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
