import { Decimal } from 'decimal.js';
import { atr } from '../indicators/atr.js';
import type { Candle, Side } from '../types.js';

/** B8.1 lookbacks and thresholds. */
export const PIVOT_LEFT = 5;
export const PIVOT_RIGHT = 5;
export const CHANNEL_LOOKBACK = 60;
export const CHANNEL_MIN_PIVOTS = 3;
/** A pivot "touches" the channel line when within this % of the line value. */
export const CHANNEL_TOUCH_PCT = new Decimal(1);
export const EXHAUSTION_BARS = 10;
export const BIG_BODY_ATR = new Decimal('1.5');
export const BIG_BODY_ATR_LENGTH = 14;
export const VOLUME_AVG_BARS = 20;
export const SWING_LOOKBACK = 120;

export type FactorName =
  | 'channel_breakout'
  | 'capitulation'
  | 'higher_low'
  | 'channel_breakdown'
  | 'euphoria'
  | 'lower_high';

/** Factor names in B8 order (channel, exhaustion, swing) for each side. */
export const FACTOR_NAMES: Record<Side, [FactorName, FactorName, FactorName]> = {
  long: ['channel_breakout', 'capitulation', 'higher_low'],
  short: ['channel_breakdown', 'euphoria', 'lower_high'],
};

/**
 * Channel breakout (long) / ascending-channel breakdown (short).
 * Long: least-squares line through the pivot highs of the last 60 bars.
 * Short: the same on pivot lows.
 */
export interface ChannelFeature {
  pivotCount: number;
  /** Line slope per bar as % of the mean pivot price; null with < 3 pivots. Long: negative = descending. */
  slopePctPerBar: Decimal | null;
  /** Pivots within 1% of the line. */
  touches: number;
  /** Long: % the signal close is above the line; short: % below it. Null with < 3 pivots. */
  closeBeyondPct: Decimal | null;
}

/** Capitulation (long: big bearish bodies, gap-downs) / euphoria (short: big bullish bodies, gap-ups). */
export interface ExhaustionFeature {
  /** Longest run of consecutive big-body candles against the new side in the 10 bars before the signal. */
  longestBigBodyRun: number;
  /** Long: opens below the previous low; short: opens above the previous high. */
  gapCount: number;
  /** Max volume of those 10 bars ÷ average volume of the 20 bars before them; null if unavailable. */
  volumeSpike: Decimal | null;
}

/** Higher low (long: last two pivot lows) / lower high (short: last two pivot highs). */
export interface SwingFeature {
  /** % change between the last two swing points, signed so > 0 favours the side; null with < 2 pivots. */
  changePct: Decimal | null;
  /** Bars between the two swing points; null with < 2 pivots. */
  barsApart: number | null;
}

export interface ConfluenceFeatures {
  side: Side;
  timeframe: '1d';
  /** openTime of the signal candle (UTC ms). */
  signalOpenTime: number;
  channel: ChannelFeature;
  exhaustion: ExhaustionFeature;
  swing: SwingFeature;
}

/** Price mirror used for the short side: highs become lows, everything negated. */
function mirror(c: Candle): Candle {
  return { ...c, open: c.open.neg(), high: c.low.neg(), low: c.high.neg(), close: c.close.neg() };
}

/** Pivot highs (strictly higher than `left` bars before and `right` bars after), confirmed by `last`. */
function pivotHighs(candles: readonly Candle[], from: number, last: number): number[] {
  const out: number[] = [];
  for (let j = Math.max(from, PIVOT_LEFT); j + PIVOT_RIGHT <= last; j++) {
    const h = candles[j]!.high;
    let ok = true;
    for (let k = j - PIVOT_LEFT; k <= j + PIVOT_RIGHT && ok; k++) {
      if (k !== j && !h.gt(candles[k]!.high)) ok = false;
    }
    if (ok) out.push(j);
  }
  return out;
}

function pivotLows(candles: readonly Candle[], from: number, last: number): number[] {
  const out: number[] = [];
  for (let j = Math.max(from, PIVOT_LEFT); j + PIVOT_RIGHT <= last; j++) {
    const l = candles[j]!.low;
    let ok = true;
    for (let k = j - PIVOT_LEFT; k <= j + PIVOT_RIGHT && ok; k++) {
      if (k !== j && !l.lt(candles[k]!.low)) ok = false;
    }
    if (ok) out.push(j);
  }
  return out;
}

function channel(candles: readonly Candle[], i: number): ChannelFeature {
  const pivots = pivotHighs(candles, i - CHANNEL_LOOKBACK + 1, i);
  const n = pivots.length;
  if (n < CHANNEL_MIN_PIVOTS) return { pivotCount: n, slopePctPerBar: null, touches: 0, closeBeyondPct: null };
  let sx = new Decimal(0);
  let sy = new Decimal(0);
  let sxy = new Decimal(0);
  let sxx = new Decimal(0);
  for (const j of pivots) {
    const y = candles[j]!.high;
    sx = sx.plus(j);
    sy = sy.plus(y);
    sxy = sxy.plus(y.times(j));
    sxx = sxx.plus(j * j);
  }
  const slope = sxy.times(n).minus(sx.times(sy)).div(sxx.times(n).minus(sx.times(sx)));
  const intercept = sy.minus(slope.times(sx)).div(n);
  const line = (x: number) => intercept.plus(slope.times(x));
  const meanPivot = sy.div(n).abs();
  const atSignal = line(i);
  // Zeroed bars from a bad feed: no line rather than a division by zero.
  if (meanPivot.isZero() || atSignal.isZero()) return { pivotCount: n, slopePctPerBar: null, touches: 0, closeBeyondPct: null };
  const touches = pivots.filter((j) => {
    const l = line(j);
    return candles[j]!.high.minus(l).abs().lte(l.abs().times(CHANNEL_TOUCH_PCT).div(100));
  }).length;
  return {
    pivotCount: n,
    slopePctPerBar: slope.div(meanPivot).times(100),
    touches,
    closeBeyondPct: candles[i]!.close.minus(atSignal).div(atSignal.abs()).times(100),
  };
}

function exhaustion(candles: readonly Candle[], i: number): ExhaustionFeature {
  const atr14 = atr(candles.slice(0, i + 1), BIG_BODY_ATR_LENGTH);
  const start = Math.max(1, i - EXHAUSTION_BARS);
  let run = 0;
  let longest = 0;
  let gaps = 0;
  let maxVol: Decimal | null = null;
  for (let j = start; j < i; j++) {
    const c = candles[j]!;
    const a = atr14[j] ?? null;
    const big = a !== null && c.close.lt(c.open) && c.open.minus(c.close).gte(a.times(BIG_BODY_ATR));
    run = big ? run + 1 : 0;
    longest = Math.max(longest, run);
    if (c.open.lt(candles[j - 1]!.low)) gaps++;
    maxVol = maxVol === null ? c.volume : Decimal.max(maxVol, c.volume);
  }
  let volumeSpike: Decimal | null = null;
  const avgFrom = i - EXHAUSTION_BARS - VOLUME_AVG_BARS;
  if (maxVol !== null && avgFrom >= 0) {
    let sum = new Decimal(0);
    for (let j = avgFrom; j < i - EXHAUSTION_BARS; j++) sum = sum.plus(candles[j]!.volume);
    const avg = sum.div(VOLUME_AVG_BARS);
    if (avg.gt(0)) volumeSpike = maxVol.div(avg);
  }
  return { longestBigBodyRun: longest, gapCount: gaps, volumeSpike };
}

function swing(candles: readonly Candle[], i: number): SwingFeature {
  const lows = pivotLows(candles, i - SWING_LOOKBACK + 1, i);
  if (lows.length < 2) return { changePct: null, barsApart: null };
  const a = lows[lows.length - 2]!;
  const b = lows[lows.length - 1]!;
  const la = candles[a]!.low;
  if (la.isZero()) return { changePct: null, barsApart: b - a };
  return { changePct: candles[b]!.low.minus(la).div(la.abs()).times(100), barsApart: b - a };
}

/**
 * B8.1 features from the 1D candles up to and including the signal candle.
 * The short side is computed on the price mirror, so every feature keeps the
 * same meaning ("> 0 / more favours the side"): pivot highs become pivot
 * lows, bearish bodies become bullish bodies, gap-downs become gap-ups.
 * Only market data goes in or out (B8.2).
 */
export function confluenceFeatures(candles: readonly Candle[], signalIndex: number, side: Side): ConfluenceFeatures {
  if (!Number.isInteger(signalIndex) || signalIndex < 0 || signalIndex >= candles.length) {
    throw new Error(`signal index out of range: ${signalIndex}`);
  }
  const series = side === 'long' ? candles : candles.map(mirror);
  return {
    side,
    timeframe: '1d',
    signalOpenTime: candles[signalIndex]!.openTime,
    channel: channel(series, signalIndex),
    exhaustion: exhaustion(series, signalIndex),
    swing: swing(series, signalIndex),
  };
}
