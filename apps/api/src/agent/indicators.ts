/**
 * indicators.ts — Full algorithmic indicator library
 *
 * Provides deterministic, pure-function implementations of all technical
 * indicators used by TradeAgent strategies. No side effects, fully testable.
 *
 * Indicators: EMA · RSI (Wilder) · MACD · Bollinger Bands · ATR · Volume
 * Output: IndicatorResult with composite score (−100 to +100)
 */

export interface OHLCV {
  open:      number;
  high:      number;
  low:       number;
  close:     number;
  volume:    number;
  timestamp: number;
}

export interface IndicatorResult {
  ema: {
    fast:   number;
    slow:   number;
    signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  };
  rsi: {
    value:  number;
    signal: 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL';
  };
  macd: {
    macdLine:   number;
    signalLine: number;
    histogram:  number;
    signal:     'BULLISH' | 'BEARISH' | 'NEUTRAL';
  };
  bollinger: {
    upper:     number;
    middle:    number;
    lower:     number;
    bandwidth: number;
    signal:    'BREAKOUT_UP' | 'BREAKOUT_DOWN' | 'NEUTRAL';
  };
  atr:    { value: number };
  volume: { avg: number; current: number; surge: boolean };
  compositeScore: number; // −100 to +100
}

// ── EMA — Exponential Moving Average ──────────────────────────────
// Gives MORE weight to recent prices vs SMA.
// EMA(t) = price(t) * k + EMA(t-1) * (1 - k), k = 2/(period+1)
export function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length < period) return [];
  const k    = 2 / (period + 1);
  const emas: number[] = [];
  // Seed with SMA of first {period} prices
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  emas.push(ema);
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    emas.push(ema);
  }
  return emas;
}

// ── RSI — Relative Strength Index (Wilder smoothing) ──────────────
// 0-30 = oversold (BUY signal), 70-100 = overbought (SELL signal)
// RSI = 100 − (100 / (1 + RS)), RS = avgGain / avgLoss
export function calculateRSI(prices: number[], period = 14): number[] {
  const rsis: number[] = [];
  let avgGain = 0, avgLoss = 0;

  // Initial average over first period
  for (let i = 1; i <= period && i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) avgGain += change / period;
    else            avgLoss += Math.abs(change) / period;
  }
  rsis.push(100 - 100 / (1 + avgGain / (avgLoss || 0.001)));

  // Subsequent RSI uses Wilder smoothing
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain   = Math.max(change, 0);
    const loss   = Math.abs(Math.min(change, 0));
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsis.push(100 - 100 / (1 + avgGain / (avgLoss || 0.001)));
  }
  return rsis;
}

// ── MACD — Moving Average Convergence Divergence ──────────────────
// Trend-following momentum: fast EMA − slow EMA.
// Signal line = EMA of MACD; Histogram = MACD − Signal
// BUY: histogram crosses above 0 | SELL: histogram crosses below 0
export function calculateMACD(
  prices: number[],
  fast   = 12,
  slow   = 26,
  signal = 9,
): { macd: number[]; signal: number[]; histogram: number[] } {
  const fastEMA = calculateEMA(prices, fast);
  const slowEMA = calculateEMA(prices, slow);
  const offset  = slow - fast;
  const macd    = fastEMA.slice(offset).map((f, i) => f - slowEMA[i]);
  const sig     = calculateEMA(macd, signal);
  const hist    = macd.slice(signal - 1).map((m, i) => m - sig[i]);
  return { macd: macd.slice(signal - 1), signal: sig, histogram: hist };
}

// ── Bollinger Bands ────────────────────────────────────────────────
// Upper/Lower = SMA ± (stdDevMult × stddev). Bandwidth = (upper−lower)/middle.
// Price above upper = overbought breakout; below lower = oversold breakdown.
export function calculateBollinger(
  prices:      number[],
  period       = 20,
  stdDevMult   = 2,
): { upper: number[]; middle: number[]; lower: number[]; bandwidth: number[] } {
  const upper: number[] = [], middle: number[] = [];
  const lower: number[] = [], bandwidth: number[] = [];
  for (let i = period - 1; i < prices.length; i++) {
    const slice    = prices.slice(i - period + 1, i + 1);
    const sma      = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - sma) ** 2, 0) / period;
    const std      = Math.sqrt(variance);
    middle.push(sma);
    upper.push(sma + stdDevMult * std);
    lower.push(sma - stdDevMult * std);
    bandwidth.push((sma + stdDevMult * std - (sma - stdDevMult * std)) / sma);
  }
  return { upper, middle, lower, bandwidth };
}

// ── ATR — Average True Range ───────────────────────────────────────
// Measures volatility. Used for stop-loss placement.
// TR = max(high−low, |high−prevClose|, |low−prevClose|)
export function calculateATR(ohlcv: OHLCV[], period = 14): number[] {
  const trs: number[] = [];
  for (let i = 1; i < ohlcv.length; i++) {
    const tr = Math.max(
      ohlcv[i].high - ohlcv[i].low,
      Math.abs(ohlcv[i].high - ohlcv[i - 1].close),
      Math.abs(ohlcv[i].low  - ohlcv[i - 1].close),
    );
    trs.push(tr);
  }
  return calculateEMA(trs, period);
}

// ── Volume Analysis ────────────────────────────────────────────────
// Surge = current volume > 1.5× rolling average (50% above avg)
export function analyzeVolume(
  ohlcv:  OHLCV[],
  period = 20,
): { avg: number; current: number; surge: boolean } {
  const volumes = ohlcv.map(c => c.volume);
  const recent  = volumes.slice(-period);
  const avg     = recent.reduce((a, b) => a + b, 0) / period;
  const current = volumes[volumes.length - 1];
  return { avg, current, surge: current > avg * 1.5 };
}

// ── Master Indicator Calculator ────────────────────────────────────
// Returns fully populated IndicatorResult including composite score.
export function calculateAllIndicators(
  ohlcv:  OHLCV[],
  config: { fastEMA: number; slowEMA: number; rsiPeriod: number },
): IndicatorResult {
  const closes  = ohlcv.map(c => c.close);
  const current = closes[closes.length - 1];

  const fastEMAs = calculateEMA(closes, config.fastEMA);
  const slowEMAs = calculateEMA(closes, config.slowEMA);
  const rsis     = calculateRSI(closes, config.rsiPeriod);
  const macdData = calculateMACD(closes);
  const bollData = calculateBollinger(closes);
  const atrData  = calculateATR(ohlcv);
  const volData  = analyzeVolume(ohlcv);

  const fastEMA  = fastEMAs[fastEMAs.length - 1];
  const slowEMA  = slowEMAs[slowEMAs.length - 1];
  const rsi      = rsis[rsis.length - 1];
  const macdLine = macdData.macd[macdData.macd.length - 1];
  const sigLine  = macdData.signal[macdData.signal.length - 1];
  const hist     = macdData.histogram[macdData.histogram.length - 1];
  const prevHist = macdData.histogram[macdData.histogram.length - 2] ?? 0;

  // EMA signal: bullish when fast > slow (uptrend), 0.1% threshold to reduce noise
  const emaSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
    fastEMA > slowEMA * 1.001 ? 'BULLISH' :
    fastEMA < slowEMA * 0.999 ? 'BEARISH' : 'NEUTRAL';

  // RSI signal
  const rsiSignal: 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL' =
    rsi < 30 ? 'OVERSOLD' : rsi > 70 ? 'OVERBOUGHT' : 'NEUTRAL';

  // MACD signal: histogram turning from negative to positive = bullish crossover
  const macdSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
    hist > 0 && prevHist <= 0 ? 'BULLISH' :
    hist < 0 && prevHist >= 0 ? 'BEARISH' : 'NEUTRAL';

  const bollUpper = bollData.upper[bollData.upper.length - 1];
  const bollLower = bollData.lower[bollData.lower.length - 1];
  const boll = {
    upper:     bollUpper,
    middle:    bollData.middle[bollData.middle.length - 1],
    lower:     bollLower,
    bandwidth: bollData.bandwidth[bollData.bandwidth.length - 1],
    signal: (current > bollUpper ? 'BREAKOUT_UP' :
             current < bollLower ? 'BREAKOUT_DOWN' : 'NEUTRAL') as
             'BREAKOUT_UP' | 'BREAKOUT_DOWN' | 'NEUTRAL',
  };

  // Composite score: weighted sum of each signal (−100 to +100)
  let score = 0;
  if (emaSignal === 'BULLISH') score += 40;
  if (emaSignal === 'BEARISH') score -= 40;
  if (rsiSignal === 'OVERSOLD')    score += 30;
  if (rsiSignal === 'OVERBOUGHT')  score -= 30;
  if (macdSignal === 'BULLISH') score += 20;
  if (macdSignal === 'BEARISH') score -= 20;
  if (boll.signal === 'BREAKOUT_UP')   score += 10;
  if (boll.signal === 'BREAKOUT_DOWN') score -= 10;

  return {
    ema:      { fast: fastEMA, slow: slowEMA, signal: emaSignal },
    rsi:      { value: rsi,   signal: rsiSignal },
    macd:     { macdLine, signalLine: sigLine, histogram: hist, signal: macdSignal },
    bollinger: boll,
    atr:      { value: atrData[atrData.length - 1] ?? 0 },
    volume:   volData,
    compositeScore: Math.max(-100, Math.min(100, score)),
  };
}

// ── Helpers ────────────────────────────────────────────────────────

/** Convert an array of close prices + a current price to a minimal OHLCV array.
 *  Used when only close prices are available (Binance klines fallback). */
export function pricesToOHLCV(prices: number[]): OHLCV[] {
  return prices.map((close, i) => ({
    open:      i > 0 ? prices[i - 1] : close,
    high:      close,
    low:       close,
    close,
    volume:    1,  // synthetic — volume surge detection disabled in this mode
    timestamp: Date.now() - (prices.length - i) * 3600_000,
  }));
}
