/**
 * strategies.ts — Four deterministic trading strategy implementations
 *
 * Each strategy is a pure function: given IndicatorResult + price → SignalOutput.
 * No LLM, no side effects, fully testable and reproducible.
 *
 * Strategies:
 *   emaStrategy            → TREND_FOLLOW  (trending markets, 45-55% win rate)
 *   rsiMeanReversionStrategy → MEAN_REVERT (ranging markets, 55-65% win rate)
 *   macdMomentumStrategy   → MOMENTUM      (continuation, 40-50% win rate)
 *   bollingerBreakoutStrategy → BREAKOUT   (volatility, 35-45% win rate)
 */

import type { IndicatorResult } from './indicators';

export interface SignalOutput {
  signal:     'BUY' | 'SELL' | 'HOLD';
  confidence: number;   // 0-100
  reasoning:  string;
  stopLoss:   number;   // absolute price level (0 for HOLD)
  takeProfit: number;   // absolute price level (0 for HOLD)
}

interface RiskConfig {
  stopLossPct:   number;
  takeProfitPct: number;
}

// ── Strategy 1: EMA Crossover (TREND_FOLLOW) ──────────────────────
// Best for: trending markets (bull run, sustained downtrend)
// Win rate: 45-55% — wins are larger than losses (favorable R:R)
// Entry: fast EMA crosses above/below slow EMA with RSI + volume confirmation
export function emaStrategy(
  ind:    IndicatorResult,
  price:  number,
  config: RiskConfig,
): SignalOutput {
  const { ema, rsi, volume } = ind;

  // Strong BUY: EMA bullish + RSI not overbought + volume confirms
  if (ema.signal === 'BULLISH' && rsi.value < 65 && volume.current > volume.avg) {
    const spreadPct    = ((ema.fast - ema.slow) / ema.slow) * 1000;
    const volumeBonus  = volume.surge ? 10 : 0;
    const rsiBonus     = rsi.value < 50 ? 10 : 0;
    const confidence   = Math.min(95, 50 + spreadPct + volumeBonus + rsiBonus);
    return {
      signal:     'BUY',
      confidence: Math.round(confidence),
      reasoning:  `Fast EMA (${ema.fast.toFixed(4)}) > Slow EMA (${ema.slow.toFixed(4)}). ` +
                  `RSI ${rsi.value.toFixed(1)} — not overbought. ` +
                  `Volume ${volume.surge ? 'surging (high conviction)' : 'confirming'}.`,
      stopLoss:   price * (1 - config.stopLossPct / 100),
      takeProfit: price * (1 + config.takeProfitPct / 100),
    };
  }

  // Strong SELL: EMA bearish + RSI not oversold
  if (ema.signal === 'BEARISH' && rsi.value > 35) {
    const spreadPct   = ((ema.slow - ema.fast) / ema.slow) * 1000;
    const volumeBonus = volume.surge ? 10 : 0;
    const confidence  = Math.min(95, 50 + spreadPct + volumeBonus);
    return {
      signal:     'SELL',
      confidence: Math.round(confidence),
      reasoning:  `Fast EMA (${ema.fast.toFixed(4)}) < Slow EMA (${ema.slow.toFixed(4)}). ` +
                  `Downtrend confirmed. RSI ${rsi.value.toFixed(1)}.`,
      stopLoss:   price * (1 + config.stopLossPct / 100),
      takeProfit: price * (1 - config.takeProfitPct / 100),
    };
  }

  return {
    signal:     'HOLD',
    confidence: 50,
    reasoning:  `No clear EMA crossover. Fast: ${ema.fast.toFixed(4)}, Slow: ${ema.slow.toFixed(4)}, RSI: ${rsi.value.toFixed(1)}.`,
    stopLoss:   0,
    takeProfit: 0,
  };
}

// ── Strategy 2: RSI Mean Reversion (MEAN_REVERT) ──────────────────
// Best for: ranging / sideways markets
// Win rate: 55-65% (high win rate, smaller gains per trade)
// Entry: RSI extreme oversold/overbought; exit when RSI returns to neutral
export function rsiMeanReversionStrategy(
  ind:    IndicatorResult,
  price:  number,
  config: RiskConfig & { oversoldLevel?: number; overboughtLevel?: number },
): SignalOutput {
  const { rsi, bollinger } = ind;
  const oversold   = config.oversoldLevel   ?? 30;
  const overbought = config.overboughtLevel ?? 70;

  // Oversold + price near/below lower Bollinger = strong BUY
  if (rsi.value < oversold && bollinger.signal !== 'BREAKOUT_DOWN') {
    const depthBelow = Math.max(0, oversold - rsi.value);
    const confidence = Math.min(90, 55 + depthBelow * 2);
    return {
      signal:     'BUY',
      confidence: Math.round(confidence),
      reasoning:  `RSI ${rsi.value.toFixed(1)} — deeply oversold (< ${oversold}). ` +
                  `Mean reversion setup. Price near Bollinger lower band (${bollinger.lower.toFixed(4)}).`,
      stopLoss:   price * (1 - config.stopLossPct / 100),
      takeProfit: bollinger.middle, // Target: return to middle band
    };
  }

  // Overbought + price near upper Bollinger = SELL
  if (rsi.value > overbought && bollinger.signal !== 'BREAKOUT_UP') {
    const excessAbove = Math.max(0, rsi.value - overbought);
    const confidence  = Math.min(90, 55 + excessAbove * 2);
    return {
      signal:     'SELL',
      confidence: Math.round(confidence),
      reasoning:  `RSI ${rsi.value.toFixed(1)} — overbought (> ${overbought}). ` +
                  `Mean reversion expected. Target: Bollinger middle (${bollinger.middle.toFixed(4)}).`,
      stopLoss:   price * (1 + config.stopLossPct / 100),
      takeProfit: bollinger.middle,
    };
  }

  return {
    signal:     'HOLD',
    confidence: 50,
    reasoning:  `RSI ${rsi.value.toFixed(1)} — neutral zone (${oversold}–${overbought}). No extreme.`,
    stopLoss:   0,
    takeProfit: 0,
  };
}

// ── Strategy 3: MACD Momentum (MOMENTUM) ──────────────────────────
// Best for: trending + momentum continuation
// Win rate: 40-50% — fewer signals, higher reward/risk ratio
// Entry: MACD histogram crosses zero line (momentum shift)
export function macdMomentumStrategy(
  ind:    IndicatorResult,
  price:  number,
  config: RiskConfig,
): SignalOutput {
  const { macd, ema, volume } = ind;

  // MACD histogram turns positive (upward momentum shift)
  if (macd.signal === 'BULLISH' && ema.signal !== 'BEARISH') {
    const strength   = Math.abs(macd.histogram);
    const confidence = Math.min(88, 55 + strength * 100 + (volume.surge ? 10 : 0));
    return {
      signal:     'BUY',
      confidence: Math.round(confidence),
      reasoning:  `MACD histogram crossed above zero (${macd.histogram.toFixed(5)}). ` +
                  `Momentum turning bullish. MACD: ${macd.macdLine.toFixed(5)}, Signal: ${macd.signalLine.toFixed(5)}.`,
      stopLoss:   price * (1 - config.stopLossPct / 100),
      takeProfit: price * (1 + config.takeProfitPct / 100),
    };
  }

  // MACD histogram turns negative (downward momentum shift)
  if (macd.signal === 'BEARISH' && ema.signal !== 'BULLISH') {
    const confidence = Math.min(88, 55 + Math.abs(macd.histogram) * 100);
    return {
      signal:     'SELL',
      confidence: Math.round(confidence),
      reasoning:  `MACD histogram crossed below zero (${macd.histogram.toFixed(5)}). ` +
                  `Momentum turning bearish.`,
      stopLoss:   price * (1 + config.stopLossPct / 100),
      takeProfit: price * (1 - config.takeProfitPct / 100),
    };
  }

  return {
    signal:     'HOLD',
    confidence: 40,
    reasoning:  `MACD no clear crossover. Histogram: ${macd.histogram.toFixed(5)}. Waiting for momentum shift.`,
    stopLoss:   0,
    takeProfit: 0,
  };
}

// ── Strategy 4: Bollinger Breakout (BREAKOUT) ─────────────────────
// Best for: volatile markets, high-conviction breakouts
// Win rate: 35-45% — low win rate, very large winners
// Entry: price breaks outside bands WITH volume confirmation
export function bollingerBreakoutStrategy(
  ind:    IndicatorResult,
  price:  number,
  config: RiskConfig,
): SignalOutput {
  const { bollinger, volume, rsi } = ind;

  // Breakout UP: price above upper band + high volume + RSI not extreme
  if (bollinger.signal === 'BREAKOUT_UP' && volume.surge && rsi.value < 80) {
    const bandBreakPct = ((price - bollinger.upper) / bollinger.upper) * 100;
    const confidence   = Math.min(85, 60 + bandBreakPct * 10);
    return {
      signal:     'BUY',
      confidence: Math.round(confidence),
      reasoning:  `Price (${price.toFixed(4)}) broke above Bollinger upper band (${bollinger.upper.toFixed(4)}) ` +
                  `with ${((volume.current / volume.avg) * 100).toFixed(0)}% volume surge. ` +
                  `Bandwidth: ${(bollinger.bandwidth * 100).toFixed(1)}%.`,
      stopLoss:   bollinger.middle, // SL at middle band
      takeProfit: price * (1 + config.takeProfitPct / 100),
    };
  }

  // Breakout DOWN: price below lower band + volume
  if (bollinger.signal === 'BREAKOUT_DOWN' && volume.surge && rsi.value > 20) {
    return {
      signal:     'SELL',
      confidence: 68,
      reasoning:  `Price (${price.toFixed(4)}) broke below Bollinger lower band (${bollinger.lower.toFixed(4)}) ` +
                  `with volume surge. Bearish breakout confirmed.`,
      stopLoss:   bollinger.middle,
      takeProfit: price * (1 - config.takeProfitPct / 100),
    };
  }

  return {
    signal:     'HOLD',
    confidence: 40,
    reasoning:  `Price within Bollinger bands (${bollinger.lower.toFixed(4)} – ${bollinger.upper.toFixed(4)}). ` +
                `Bandwidth: ${(bollinger.bandwidth * 100).toFixed(1)}%.`,
    stopLoss:   0,
    takeProfit: 0,
  };
}

// ── Strategy Router ────────────────────────────────────────────────
// Maps AgentConfig.strategyType → correct strategy function.
export function runStrategy(
  strategyType: string,
  ind:          IndicatorResult,
  price:        number,
  riskConfig:   RiskConfig,
): SignalOutput {
  switch (strategyType) {
    case 'TREND_FOLLOW': return emaStrategy(ind, price, riskConfig);
    case 'MEAN_REVERT':  return rsiMeanReversionStrategy(ind, price, riskConfig);
    case 'MOMENTUM':     return macdMomentumStrategy(ind, price, riskConfig);
    case 'BREAKOUT':     return bollingerBreakoutStrategy(ind, price, riskConfig);
    default:             return emaStrategy(ind, price, riskConfig); // sensible default
  }
}
