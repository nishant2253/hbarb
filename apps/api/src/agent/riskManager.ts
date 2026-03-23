/**
 * riskManager.ts — Risk management engine
 *
 * Provides:
 *   calculatePositionSize    — half-Kelly Criterion × confidence scaling
 *   calculateDynamicStopLoss — ATR-based stop loss (adapts to volatility)
 *   checkRiskGates           — halt trading if daily loss / drawdown exceeded
 *   calculateWinRate         — Sharpe, profit factor, expectancy, R-multiple
 */

export interface RiskConfig {
  maxPositionSizePct: number;  // % of portfolio per trade
  stopLossPct:        number;  // % below entry to exit
  takeProfitPct:      number;  // % above entry to exit
  maxDailyLossPct:    number;  // halt if daily loss exceeds this
  maxDrawdownPct:     number;  // halt if drawdown from peak exceeds this
  maxOpenPositions:   number;  // max concurrent positions
}

export interface WinRateResult {
  winRate:      number;  // 0–100
  avgWin:       number;  // avg gain % on winning trades
  avgLoss:      number;  // avg loss % on losing trades
  profitFactor: number;  // totalGains / totalLosses (> 1 = profitable)
  expectancy:   number;  // expected % return per trade
  sharpeRatio:  number;  // risk-adjusted annualized return
  rMultiple:    number;  // avgWin / avgLoss ratio
}

// ── Kelly Criterion Position Sizing ───────────────────────────────
// Mathematically optimal fraction given win rate and reward/risk ratio.
// Kelly % = W − (1 − W) / R  where W = win rate, R = reward/risk ratio.
// We use half-Kelly (conservative) to reduce volatility.
//
// Returns position size in tinybars (bigint).
export function calculatePositionSize(
  portfolioValueTinybars: bigint,
  confidence:             number,         // 0–100 from strategy signal
  config:                 { maxPositionSizePct: number },
  historicalWinRate       = 0.50,          // 0–1 from past executions
  rewardRiskRatio         = 2.0,           // takeProfitPct / stopLossPct
): bigint {
  // Kelly formula
  const kellyPct  = historicalWinRate - (1 - historicalWinRate) / rewardRiskRatio;
  const halfKelly = Math.max(0, kellyPct / 2); // conservative

  // Cap at configured max, scale by signal confidence
  const confidenceScale = confidence / 100;
  const finalPct = Math.min(
    config.maxPositionSizePct / 100,
    halfKelly * confidenceScale,
  );

  // Minimum 1% to ensure trades actually fire
  const effectivePct = Math.max(finalPct, 0.01);
  return BigInt(Math.floor(Number(portfolioValueTinybars) * effectivePct));
}

// ── Dynamic Stop Loss (ATR-based) ──────────────────────────────────
// Adapts to current market volatility instead of a fixed %.
// Stop = entry − (ATR × multiplier) for longs,
//        entry + (ATR × multiplier) for shorts.
export function calculateDynamicStopLoss(
  entryPrice: number,
  atr:        number,
  side:       'LONG' | 'SHORT',
  multiplier  = 2.0, // 2× ATR is industry standard
): number {
  return side === 'LONG'
    ? entryPrice - atr * multiplier
    : entryPrice + atr * multiplier;
}

// ── Risk Gate Checks ───────────────────────────────────────────────
// Must ALL pass before a trade is executed.
export function checkRiskGates(
  config:          RiskConfig,
  dailyPnLPct:     number, // today's P&L as % of portfolio (negative = loss)
  currentDrawdown: number, // drawdown from all-time high as %
  openPositions:   number,
): { allowed: boolean; reason: string } {
  if (dailyPnLPct < -config.maxDailyLossPct) {
    return {
      allowed: false,
      reason:  `Daily loss limit reached: ${dailyPnLPct.toFixed(2)}% < −${config.maxDailyLossPct}%. Trading halted today.`,
    };
  }
  if (currentDrawdown > config.maxDrawdownPct) {
    return {
      allowed: false,
      reason:  `Max drawdown exceeded: ${currentDrawdown.toFixed(2)}% > ${config.maxDrawdownPct}%. System protection active.`,
    };
  }
  if (openPositions >= config.maxOpenPositions) {
    return {
      allowed: false,
      reason:  `Max concurrent positions (${config.maxOpenPositions}) reached.`,
    };
  }
  return { allowed: true, reason: 'All risk gates passed.' };
}

// ── Win Rate & Performance Calculator ─────────────────────────────
// Accepts an array of {pnlPct} objects (from DB Execution records).
// Returns Sharpe ratio, profit factor, expectancy, and R-multiple.
export function calculateWinRate(
  executions: { pnlPct: number }[],
): WinRateResult {
  if (!executions.length) {
    return {
      winRate: 0, avgWin: 0, avgLoss: 0,
      profitFactor: 0, expectancy: 0, sharpeRatio: 0, rMultiple: 0,
    };
  }

  const wins   = executions.filter(e => e.pnlPct > 0);
  const losses = executions.filter(e => e.pnlPct < 0);

  const winRate     = (wins.length / executions.length) * 100;
  const avgWin      = wins.length
    ? wins.reduce((a, e) => a + e.pnlPct, 0) / wins.length : 0;
  const avgLoss     = losses.length
    ? Math.abs(losses.reduce((a, e) => a + e.pnlPct, 0) / losses.length) : 0;
  const profitFactor = avgLoss > 0
    ? (wins.length * avgWin) / (losses.length * avgLoss) : 0;
  const expectancy  = (winRate / 100) * avgWin - ((1 - winRate / 100) * avgLoss);
  const rMultiple   = avgLoss > 0 ? avgWin / avgLoss : 0;

  // Sharpe ratio: (mean return / stddev) × √365 (annualized, daily returns)
  const returns = executions.map(e => e.pnlPct);
  const mean    = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const stddev  = Math.sqrt(variance);
  const sharpeRatio = stddev > 0 ? (mean / stddev) * Math.sqrt(365) : 0;

  return {
    winRate,
    avgWin,
    avgLoss,
    profitFactor,
    expectancy,
    sharpeRatio,
    rMultiple,
  };
}

// ── Default risk config ────────────────────────────────────────────
// Used as fallback when agent config doesn't specify all fields.
export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxPositionSizePct: 5,
  stopLossPct:        2,
  takeProfitPct:      4,
  maxDailyLossPct:    5,
  maxDrawdownPct:     15,
  maxOpenPositions:   3,
};
