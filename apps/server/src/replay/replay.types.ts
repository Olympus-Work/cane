import type { Decimal } from 'decimal.js';
import type { EntryKind, Market, Regime, Side, Timeframe } from '@cane/core';

export type ReplayExitReason = 'first_red' | 'first_green' | 'stop' | 'take_profit' | 'open';

/** One simulated position. Unsized, no fees or funding: decisions only. */
export interface ReplayTrade {
  side: Side;
  kind: EntryKind;
  signalTimeframe: Timeframe;
  /** openTime of the signal candle (UTC ms). */
  signalOpenTime: number;
  /** Evaluation time the entry was decided (UTC ms). */
  entryTime: number;
  entryPrice: Decimal;
  initialStop: Decimal;
  stopSource: 'trail' | 'atr_fallback';
  takeProfit: Decimal | null;
  trend1w: Regime;
  finalStop: Decimal;
  stopMoves: number;
  exitTime: number | null;
  exitPrice: Decimal;
  exitReason: ReplayExitReason;
  /** Result in R (risk = |entry - initial stop|). */
  r: Decimal;
  /** Price change in the position's favour, percent. */
  pct: Decimal;
}

export interface ReplayResult {
  pair: string;
  market: Market;
  /** Evaluation window (UTC ms): 4H closes with from <= closeTime < to. */
  from: number;
  to: number;
  evaluations: number;
  trades: ReplayTrade[];
  /** How often each non-trading decision happened (e.g. `none:trend_filter`, `warming_up`). */
  skipped: Record<string, number>;
  /** Closed candles loaded per timeframe (full history, used for warm-up). */
  candleCounts: Record<Timeframe, number>;
  /** First candle open time per timeframe (UTC ms). */
  historyStart: Record<Timeframe, number>;
  /** Places where two consecutive closed candles are not adjacent (exchange gaps in history). */
  historyGaps: { timeframe: Timeframe; afterOpenTime: number; missing: number }[];
}
