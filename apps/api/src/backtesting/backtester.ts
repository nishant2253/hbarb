/**
 * backtesting/backtester.ts — Historical strategy simulation engine
 *
 * Runs any TradeAgent strategy over historical OHLCV data.
 * Simulates stop-loss/take-profit exits, tracks equity curve,
 * and returns the same performance metrics as the live dashboard.
 *
 * OHLCV data is fetched from CoinGecko (free, no API key required).
 *
 * POST /api/backtest
 */

import { calculateAllIndicators, pricesToOHLCV, type OHLCV } from '../agent/indicators';
import { runStrategy } from '../agent/strategies';
import { calculateWinRate } from '../agent/riskManager';
import type { AgentConfig } from '../agent/promptBuilder';

export interface BacktestResult {
  totalTrades:  number;
  winRate:      number;
  profitFactor: number;
  sharpeRatio:  number;
  maxDrawdown:  number;
  finalReturn:  number; // % from initial capital
  equityCurve:  { date: string; equity: number }[];
  trades:       {
    entry:  number;
    exit:   number;
    pnl:    number;
    signal: string;
    reason: string;
  }[];
}

// ── fetchHistoricalOHLCV ───────────────────────────────────────────
// CoinGecko free API — no key required, returns 4-hourly OHLCV.
export async function fetchHistoricalOHLCV(
  asset: string,
  days:  number,
): Promise<OHLCV[]> {
  const base = asset.split('/')[0].toLowerCase();
  const coinId = base === 'hbar' ? 'hedera-hashgraph'
    : base === 'btc'  ? 'bitcoin'
    : base === 'eth'  ? 'ethereum'
    : base;

  const url  = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;
  const res  = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}: ${await res.text()}`);
  const data = await res.json() as number[][];
  return data.map(([t, o, h, l, c]) => ({
    timestamp: t,
    open:      o, high: h, low: l, close: c,
    volume:    0, // CoinGecko OHLC endpoint doesn't include volume
  }));
}

// ── runBacktest ────────────────────────────────────────────────────
export async function runBacktest(
  config:         Partial<AgentConfig> & { strategyType: string; risk: { stopLossPct: number; takeProfitPct: number; maxPositionSizePct: number } },
  ohlcv:          OHLCV[],
  initialCapital  = 10_000,
): Promise<BacktestResult> {
  const trades: BacktestResult['trades'] = [];
  const equityCurve: BacktestResult['equityCurve'] = [
    { date: new Date(ohlcv[0]?.timestamp ?? Date.now()).toISOString(), equity: initialCapital },
  ];

  let capital  = initialCapital;
  const fastPeriod = 20;
  const slowPeriod = 60;
  const rsiPeriod  = 14;
  // Need at least 200 candles as warmup for slow indicators
  const warmup = Math.max(200, slowPeriod + 40);

  interface OpenPosition {
    side:       'LONG' | 'SHORT';
    entryPrice: number;
    stopLoss:   number;
    takeProfit: number;
    entryIdx:   number;
  }

  let position: OpenPosition | null = null;

  for (let i = warmup; i < ohlcv.length; i++) {
    const slice = ohlcv.slice(0, i + 1);
    const price = slice[slice.length - 1].close;

    let indicators;
    try {
      indicators = calculateAllIndicators(slice, { fastEMA: fastPeriod, slowEMA: slowPeriod, rsiPeriod });
    } catch {
      continue;
    }

    const stratOut = runStrategy(config.strategyType, indicators, price, config.risk);

    // ── Check if open position hit SL or TP ────────────────────
    if (position) {
      const hitSL_long  = position.side === 'LONG'  && price <= position.stopLoss;
      const hitTP_long  = position.side === 'LONG'  && price >= position.takeProfit;
      const hitSL_short = position.side === 'SHORT' && price >= position.stopLoss;
      const hitTP_short = position.side === 'SHORT' && price <= position.takeProfit;
      const signalExit  = stratOut.signal !== 'HOLD';

      if (hitSL_long || hitTP_long || hitSL_short || hitTP_short || signalExit) {
        const exitPrice = hitSL_long || hitSL_short ? position.stopLoss
          : hitTP_long || hitTP_short               ? position.takeProfit
          : price;

        const pnlPct = position.side === 'LONG'
          ? (exitPrice - position.entryPrice) / position.entryPrice * 100
          : (position.entryPrice - exitPrice) / position.entryPrice * 100;

        capital += capital * (pnlPct / 100);
        trades.push({
          entry:  position.entryPrice,
          exit:   exitPrice,
          pnl:    pnlPct,
          signal: position.side === 'LONG' ? 'BUY' : 'SELL',
          reason: hitSL_long || hitSL_short ? 'stop_loss'
            : hitTP_long || hitTP_short     ? 'take_profit'
            : 'signal_reverse',
        });
        equityCurve.push({
          date:   new Date(ohlcv[i].timestamp).toISOString(),
          equity: Math.round(capital * 100) / 100,
        });
        position = null;
      }
    }

    // ── Open new position if signal fires and no open position ──
    if (!position && stratOut.signal !== 'HOLD' && stratOut.confidence > 55) {
      position = {
        side:       stratOut.signal === 'BUY' ? 'LONG' : 'SHORT',
        entryPrice: price,
        stopLoss:   stratOut.stopLoss  || price * (1 - config.risk.stopLossPct  / 100),
        takeProfit: stratOut.takeProfit || price * (1 + config.risk.takeProfitPct / 100),
        entryIdx:   i,
      };
    }
  }

  // Close any remaining open position at last price
  if (position && ohlcv.length > 0) {
    const exitPrice = ohlcv[ohlcv.length - 1].close;
    const pnlPct    = position.side === 'LONG'
      ? (exitPrice - position.entryPrice) / position.entryPrice * 100
      : (position.entryPrice - exitPrice) / position.entryPrice * 100;
    capital += capital * (pnlPct / 100);
    trades.push({ entry: position.entryPrice, exit: exitPrice, pnl: pnlPct, signal: position.side === 'LONG' ? 'BUY' : 'SELL', reason: 'end_of_data' });
    equityCurve.push({ date: new Date().toISOString(), equity: Math.round(capital * 100) / 100 });
  }

  // ── Compute final statistics ───────────────────────────────────
  const stats = calculateWinRate(trades.map(t => ({ pnlPct: t.pnl })));
  let peak = initialCapital, maxDrawdown = 0;
  for (const p of equityCurve) {
    if (p.equity > peak) peak = p.equity;
    const dd = (peak - p.equity) / peak * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return {
    totalTrades:  trades.length,
    winRate:      stats.winRate,
    profitFactor: stats.profitFactor,
    sharpeRatio:  stats.sharpeRatio,
    maxDrawdown,
    finalReturn:  (capital - initialCapital) / initialCapital * 100,
    equityCurve,
    trades,
  };
}
