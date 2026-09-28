import { type Decimal } from 'decimal.js';
import { TIMEFRAME_MS, type Candle, type Market, type Regime, type Side, type Timeframe } from '../types.js';
import { FALLBACK_ATR_MULTIPLIER, analyzeTimeframe, lastClosedIndex, type TimeframeAnalysis } from './analyze.js';

/** B1.3: a timeframe is usable only with at least this many closed candles. */
export const WARMUP_CANDLES = 200;

/** B4.3: late-entry take-profit distance in R. */
export const LATE_ENTRY_TP_R = 2;

export interface StrategyInput {
  id: string;
  market: Market;
}

export type EntryKind = 'primary' | 'late';

export interface OpenPosition {
  side: Side;
  kind: EntryKind;
  stop: Decimal;
  /** Evaluation time the entry was decided (UTC ms). B5.3 trails only on 1D candles closed after it. */
  openedAt: number;
}

export interface SignalRef {
  timeframe: Timeframe;
  /** openTime of the closed signal candle (UTC ms). */
  openTime: number;
}

export type NoneReason = 'no_signal' | 'data_gap' | 'trend_filter' | 'spot_ignores_short' | 'invalid_stop';

export type Decision =
  | { type: 'warming_up'; timeframes: Timeframe[] }
  | { type: 'none'; reason: NoneReason; timeframes?: Timeframe[] }
  | {
      type: 'enter';
      side: Side;
      kind: EntryKind;
      signal: SignalRef;
      /** Close of the signal candle; the market order fills near it. */
      refPrice: Decimal;
      stop: Decimal;
      stopSource: 'trail' | 'atr_fallback';
      takeProfit: Decimal | null;
      trend1w: Regime;
    }
  | { type: 'exit'; side: Side; reason: 'first_red' | 'first_green'; signal: SignalRef; refPrice: Decimal }
  | { type: 'move_stop'; side: Side; stop: Decimal; signal: SignalRef };

export interface Analyses {
  '4h': TimeframeAnalysis;
  '1d': TimeframeAnalysis;
  '1w': TimeframeAnalysis;
}

export interface DecideInput {
  strategy: StrategyInput;
  analyses: Analyses;
  /** Current open position of this strategy, or null. */
  position: OpenPosition | null;
  /** Evaluation time (UTC ms). Only candles with closeTime < nowMs are used (B1.1). */
  nowMs: number;
}

/** B1.2 idempotency key: one evaluation per strategy per timeframe per candle. */
export function signalKey(strategyId: string, signal: SignalRef): string {
  return `${strategyId}:${signal.timeframe}:${signal.openTime}`;
}

interface TfView {
  a: TimeframeAnalysis;
  /** Index of the last closed candle (-1 if none). */
  i: number;
  usable: boolean;
  gap: boolean;
}

function view(a: TimeframeAnalysis, nowMs: number): TfView {
  const i = lastClosedIndex(a.candles, nowMs);
  const dur = TIMEFRAME_MS[a.timeframe];
  let gap = false;
  if (i >= 0) {
    const last = a.candles[i]!;
    // E4: the newest candle that should have closed is missing (stale data) ...
    if (nowMs > last.closeTime + dur) gap = true;
    // ... or the last two closed candles (used for prev-bar comparisons) are not adjacent.
    if (i >= 1 && last.openTime - a.candles[i - 1]!.openTime !== dur) gap = true;
  }
  return { a, i, usable: i + 1 >= WARMUP_CANDLES && !gap, gap };
}

function stopFor(side: Side, v: TfView): { stop: Decimal; source: 'trail' | 'atr_fallback' } | null {
  const close = v.a.candles[v.i]!.close;
  const trail = v.a.trail[v.i] ?? null;
  if (trail !== null && (side === 'long' ? trail.lt(close) : trail.gt(close))) {
    return { stop: trail, source: 'trail' };
  }
  const a = v.a.atr[v.i] ?? null;
  if (a === null) return null;
  const dist = a.times(FALLBACK_ATR_MULTIPLIER);
  const stop = side === 'long' ? close.minus(dist) : close.plus(dist);
  if (stop.lte(0) || dist.lte(0)) return null;
  return { stop, source: 'atr_fallback' };
}

function ref(v: TfView): SignalRef {
  return { timeframe: v.a.timeframe, openTime: v.a.candles[v.i]!.openTime };
}

function managePosition(position: OpenPosition, d: TfView): Decision {
  const bar = d.a.zone[d.i]!;
  const close = d.a.candles[d.i]!.close;
  const signal = ref(d);
  // B7.1 / B7.2: exit on the opposite first signal of the closed 1D candle.
  if (position.side === 'long' && bar.firstRed) {
    return { type: 'exit', side: 'long', reason: 'first_red', signal, refPrice: close };
  }
  if (position.side === 'short' && bar.firstGreen) {
    return { type: 'exit', side: 'short', reason: 'first_green', signal, refPrice: close };
  }
  // B5.3: after each 1D candle that closed after the entry, move the stop to
  // the new 1D trail, only in the position's favour, and only while the
  // trail is on the protective side of price.
  const trail = d.a.trail[d.i] ?? null;
  const closedAfterEntry = d.a.candles[d.i]!.closeTime >= position.openedAt;
  if (trail !== null && closedAfterEntry) {
    if (position.side === 'long' && trail.gt(position.stop) && trail.lt(close)) {
      return { type: 'move_stop', side: 'long', stop: trail, signal };
    }
    if (position.side === 'short' && trail.lt(position.stop) && trail.gt(close)) {
      return { type: 'move_stop', side: 'short', stop: trail, signal };
    }
  }
  return { type: 'none', reason: 'no_signal' };
}

/**
 * Pure decision for one strategy at `nowMs` (spec B1-B5, B7.1-7.3).
 * Sizing (B6), Jev (B8), leverage (B9) and the flip (B7.5) are applied by
 * later steps on top of an `enter` / `exit` decision.
 */
export function decide(input: DecideInput): Decision {
  const { strategy, analyses, position, nowMs } = input;
  const d = view(analyses['1d'], nowMs);
  const w = view(analyses['1w'], nowMs);
  const h = view(analyses['4h'], nowMs);

  if (position !== null) {
    if (d.gap) return { type: 'none', reason: 'data_gap', timeframes: ['1d'] };
    if (!d.usable) return { type: 'warming_up', timeframes: ['1d'] };
    return managePosition(position, d);
  }

  const gaps = [d, w].filter((v) => v.gap).map((v) => v.a.timeframe);
  if (gaps.length > 0) return { type: 'none', reason: 'data_gap', timeframes: gaps };
  const warming = [d, w].filter((v) => !v.usable).map((v) => v.a.timeframe);
  if (warming.length > 0) return { type: 'warming_up', timeframes: warming };

  const trend1w = w.a.zone[w.i]!.regime;
  const dBar = d.a.zone[d.i]!;
  const allowShort = strategy.market === 'futures';

  // B3: primary entry on a first green / first red of the last closed 1D candle.
  if (dBar.firstGreen || dBar.firstRed) {
    const side: Side = dBar.firstGreen ? 'long' : 'short';
    if (side === 'short' && !allowShort) return { type: 'none', reason: 'spot_ignores_short' };
    if (trend1w !== (side === 'long' ? 'bullish' : 'bearish')) return { type: 'none', reason: 'trend_filter' };
    const s = stopFor(side, d);
    if (s === null) return { type: 'none', reason: 'invalid_stop' };
    return {
      type: 'enter',
      side,
      kind: 'primary',
      signal: ref(d),
      refPrice: d.a.candles[d.i]!.close,
      stop: s.stop,
      stopSource: s.source,
      takeProfit: null,
      trend1w,
    };
  }

  // B4: late entry. The 1D regime already favours a side but its first
  // signal is not the last closed 1D candle -> wait for a first signal on 4H.
  const side: Side | null = dBar.regime === 'bullish' ? 'long' : dBar.regime === 'bearish' ? 'short' : null;
  if (side === null) return { type: 'none', reason: 'no_signal' };
  if (side === 'short' && !allowShort) return { type: 'none', reason: 'no_signal' };
  if (trend1w !== (side === 'long' ? 'bullish' : 'bearish')) return { type: 'none', reason: 'trend_filter' };
  if (h.gap) return { type: 'none', reason: 'data_gap', timeframes: ['4h'] };
  if (!h.usable) return { type: 'warming_up', timeframes: ['4h'] };
  const hBar = h.a.zone[h.i]!;
  if (!(side === 'long' ? hBar.firstGreen : hBar.firstRed)) return { type: 'none', reason: 'no_signal' };
  const s = stopFor(side, h);
  if (s === null) return { type: 'none', reason: 'invalid_stop' };
  const entry = h.a.candles[h.i]!.close;
  const r = entry.minus(s.stop).abs();
  const takeProfit = side === 'long' ? entry.plus(r.times(LATE_ENTRY_TP_R)) : entry.minus(r.times(LATE_ENTRY_TP_R));
  return {
    type: 'enter',
    side,
    kind: 'late',
    signal: ref(h),
    refPrice: entry,
    stop: s.stop,
    stopSource: s.source,
    takeProfit,
    trend1w,
  };
}

export interface EvaluateInput {
  strategy: StrategyInput;
  candles: Record<Timeframe, readonly Candle[]>;
  position: OpenPosition | null;
  nowMs: number;
}

/** Convenience: analyse the candles and decide. Candles that are still open are ignored. */
export function evaluate(input: EvaluateInput): Decision {
  const analyses: Analyses = {
    '4h': analyzeTimeframe('4h', input.candles['4h']),
    '1d': analyzeTimeframe('1d', input.candles['1d']),
    '1w': analyzeTimeframe('1w', input.candles['1w']),
  };
  return decide({ strategy: input.strategy, analyses, position: input.position, nowMs: input.nowMs });
}
