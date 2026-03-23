/**
 * analytics/performance.ts — Agent performance analytics
 *
 * Queries the Hedera Mirror Node for all HCS messages on an agent's topic,
 * builds trade pairs (entry → exit), computes equity curve, and returns
 * a comprehensive set of performance metrics. All data is sourced from
 * the immutable HCS record — not the database — making it verifiable.
 *
 * GET /api/analytics/:agentId/performance
 */

import prisma from '../db/prisma';
import { calculateWinRate } from '../agent/riskManager';

const MIRROR_BASE = process.env.MIRROR_NODE_URL ||
  'https://testnet.mirrornode.hedera.com';

export interface EquityPoint {
  timestamp: number;
  equity:    number; // indexed to 100 at start
}

export interface TradePair {
  entrySignal: { signal: string; price: number; confidence: number; timestamp: number };
  exitSignal:  { signal: string; price: number; confidence: number; timestamp: number };
  pnlPct:      number;
}

export interface AgentPerformance {
  // Core metrics
  winRate:       number;
  profitFactor:  number;
  sharpeRatio:   number;
  expectancy:    number;
  maxDrawdown:   number;
  totalTrades:   number;
  avgWin:        number;
  avgLoss:       number;
  finalReturn:   number; // % from start
  rMultiple:     number;

  // Chart data
  equityCurve:   EquityPoint[];
  recentTrades:  TradePair[];

  // Signal distribution
  signalDist:    { BUY: number; SELL: number; HOLD: number };

  // HCS source proof
  hcsTopicId:    string;
  totalHCSMsgs:  number;
  source:        'hedera-mirror-node';
}

// ── fetchHCSMessages ───────────────────────────────────────────────
async function fetchHCSMessages(topicId: string, limit = 500): Promise<any[]> {
  const url = `${MIRROR_BASE}/api/v1/topics/${topicId}/messages?limit=${limit}&order=asc`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mirror Node ${res.status} for topic ${topicId}`);
  const data = await res.json() as { messages: any[] };
  return (data.messages ?? []).map((m: any) => {
    let decoded: Record<string, any> = {};
    try {
      decoded = JSON.parse(Buffer.from(m.message, 'base64').toString('utf8'));
    } catch { /* skip malformed messages */ }
    return {
      ...decoded,
      consensusTimestamp: m.consensus_timestamp,
      sequenceNumber:     m.sequence_number,
    };
  });
}

// ── getAgentPerformance ────────────────────────────────────────────
export async function getAgentPerformance(agentId: string): Promise<AgentPerformance> {
  const agent = await prisma.agent.findUnique({
    where:   { id: agentId },
    include: { executions: { orderBy: { createdAt: 'asc' } } },
  });
  if (!agent) throw new Error('Agent not found');

  // Fetch all HCS messages (source of truth — tamper-proof)
  const hcsMessages = await fetchHCSMessages(agent.hcsTopicId);

  // Signal distribution
  const signalDist = { BUY: 0, SELL: 0, HOLD: 0 };
  for (const m of hcsMessages) {
    const sig = m.signal ?? m.decision?.signal;
    if (sig === 'BUY')  signalDist.BUY++;
    else if (sig === 'SELL') signalDist.SELL++;
    else if (sig === 'HOLD') signalDist.HOLD++;
  }

  // Build trade pairs from HCS: each BUY/SELL is an entry, the next BUY/SELL is exit
  const tradeSignals = hcsMessages.filter(m => {
    const sig = m.signal ?? m.decision?.signal;
    return sig === 'BUY' || sig === 'SELL';
  });

  const trades: TradePair[] = [];
  for (let i = 0; i < tradeSignals.length - 1; i++) {
    const entry = tradeSignals[i];
    const exit  = tradeSignals[i + 1];
    const entryPrice = entry.price ?? entry.decision?.price;
    const exitPrice  = exit.price  ?? exit.decision?.price;
    const entrySignal = entry.signal ?? entry.decision?.signal;
    if (!entryPrice || !exitPrice) continue;

    const pnlPct = entrySignal === 'BUY'
      ? (exitPrice - entryPrice) / entryPrice * 100
      : (entryPrice - exitPrice) / entryPrice * 100;

    trades.push({
      entrySignal: {
        signal:     entrySignal,
        price:      entryPrice,
        confidence: entry.confidence ?? entry.decision?.confidence ?? 50,
        timestamp:  Number((entry.consensusTimestamp ?? '0').split('.')[0]) * 1000,
      },
      exitSignal: {
        signal:     exit.signal ?? exit.decision?.signal,
        price:      exitPrice,
        confidence: exit.confidence ?? exit.decision?.confidence ?? 50,
        timestamp:  Number((exit.consensusTimestamp ?? '0').split('.')[0]) * 1000,
      },
      pnlPct,
    });
  }

  // Calculate all metrics
  const stats = calculateWinRate(trades.map(t => ({ pnlPct: t.pnlPct })));

  // Build equity curve (indexed to 100)
  const equityCurve: EquityPoint[] = [];
  let equity = 100;
  const startTs = trades.length > 0
    ? trades[0].entrySignal.timestamp
    : Date.now() - 86_400_000;
  equityCurve.push({ timestamp: startTs, equity });

  for (const trade of trades) {
    equity = equity * (1 + trade.pnlPct / 100);
    equityCurve.push({
      timestamp: trade.exitSignal.timestamp || Date.now(),
      equity:    Math.round(equity * 100) / 100,
    });
  }

  // Max drawdown from equity curve
  let peak = 100, maxDrawdown = 0;
  for (const p of equityCurve) {
    if (p.equity > peak) peak = p.equity;
    const dd = (peak - p.equity) / peak * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const finalReturn = equityCurve.length > 1
    ? ((equityCurve[equityCurve.length - 1].equity - 100) / 100) * 100
    : 0;

  return {
    winRate:      stats.winRate,
    profitFactor: stats.profitFactor,
    sharpeRatio:  stats.sharpeRatio,
    expectancy:   stats.expectancy,
    maxDrawdown,
    totalTrades:  trades.length,
    avgWin:       stats.avgWin,
    avgLoss:      stats.avgLoss,
    finalReturn,
    rMultiple:    stats.rMultiple,
    equityCurve,
    recentTrades:  trades.slice(-20), // Last 20 for trade history display
    signalDist,
    hcsTopicId:   agent.hcsTopicId,
    totalHCSMsgs: hcsMessages.length,
    source:       'hedera-mirror-node',
  };
}
