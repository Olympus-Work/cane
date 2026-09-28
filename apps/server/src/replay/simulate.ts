import { Decimal } from 'decimal.js';
import {
  analyzeTimeframe,
  decide,
  signalKey,
  TIMEFRAME_MS,
  TIMEFRAMES,
  type Analyses,
  type Candle,
  type Market,
  type OpenPosition,
  type Timeframe,
} from '@cane/core';
import type { ReplayExitReason, ReplayResult, ReplayTrade } from './replay.types.js';

export interface SimulateInput {
  pair: string;
  market: Market;
  /** Full closed-candle history per timeframe (sorted, closed only). */
  candles: Record<Timeframe, readonly Candle[]>;
  from: number;
  to: number;
  strategyId?: string;
}

type Open = Omit<ReplayTrade, 'exitTime' | 'exitPrice' | 'exitReason' | 'r' | 'pct'>;

function close(pos: Open, exitTime: number | null, exitPrice: Decimal, exitReason: ReplayExitReason): ReplayTrade {
  const risk = pos.entryPrice.minus(pos.initialStop).abs();
  const move = pos.side === 'long' ? exitPrice.minus(pos.entryPrice) : pos.entryPrice.minus(exitPrice);
  return {
    ...pos,
    exitTime,
    exitPrice,
    exitReason,
    r: risk.isZero() ? new Decimal(0) : move.div(risk),
    pct: move.div(pos.entryPrice).times(100),
  };
}

/**
 * Intrabar stop / take-profit check on one closed 4H candle. A gap through
 * the level fills at the open. If both levels are inside one candle the stop
 * is assumed to fill first (conservative).
 */
function stopOrTp(pos: Open, c: Candle): { price: Decimal; reason: 'stop' | 'take_profit' } | null {
  const stop = pos.finalStop;
  const tp = pos.takeProfit;
  if (pos.side === 'long') {
    if (c.low.lte(stop)) return { price: Decimal.min(c.open, stop), reason: 'stop' };
    if (tp !== null && c.high.gte(tp)) return { price: Decimal.max(c.open, tp), reason: 'take_profit' };
  } else {
    if (c.high.gte(stop)) return { price: Decimal.max(c.open, stop), reason: 'stop' };
    if (tp !== null && c.low.lte(tp)) return { price: Decimal.min(c.open, tp), reason: 'take_profit' };
  }
  return null;
}

function historyGaps(tf: Timeframe, candles: readonly Candle[]): ReplayResult['historyGaps'] {
  const dur = TIMEFRAME_MS[tf];
  const gaps: ReplayResult['historyGaps'] = [];
  for (let i = 1; i < candles.length; i++) {
    const step = candles[i]!.openTime - candles[i - 1]!.openTime;
    if (step !== dur) gaps.push({ timeframe: tf, afterOpenTime: candles[i - 1]!.openTime, missing: step / dur - 1 });
  }
  return gaps;
}

/**
 * Replays the live decision rules (`decide` from @cane/core) at every 4H
 * close in [from, to). Uses the same pure functions as the live engine; it
 * has no exchange access and cannot place orders. `decideFn` is a test seam.
 */
export function simulate(input: SimulateInput, decideFn: typeof decide = decide): ReplayResult {
  const { pair, market, candles, from, to } = input;
  const strategy = { id: input.strategyId ?? 'REPLAY', market };
  const analyses: Analyses = {
    '4h': analyzeTimeframe('4h', candles['4h']),
    '1d': analyzeTimeframe('1d', candles['1d']),
    '1w': analyzeTimeframe('1w', candles['1w']),
  };

  const trades: ReplayTrade[] = [];
  const skipped: Record<string, number> = {};
  const seen = new Set<string>();
  let pos = null as Open | null;
  let evaluations = 0;

  for (const c of candles['4h']) {
    if (c.closeTime < from || c.closeTime >= to) continue;

    // 1) Exchange-side stop / take-profit during this 4H candle.
    if (pos !== null && c.openTime >= pos.entryTime) {
      const hit = stopOrTp(pos, c);
      if (hit !== null) {
        trades.push(close(pos, c.closeTime, hit.price, hit.reason));
        pos = null;
      }
    }

    // 2) Evaluation right after the candle closed.
    const nowMs = c.closeTime + 1;
    evaluations++;
    const position: OpenPosition | null = pos === null ? null : { side: pos.side, kind: pos.kind, stop: pos.finalStop, openedAt: pos.entryTime };
    const dec = decideFn({ strategy, analyses, position, nowMs });

    if (dec.type === 'enter') {
      const key = signalKey(strategy.id, dec.signal);
      if (seen.has(key)) continue; // B1.2: one evaluation per candle
      seen.add(key);
      pos = {
        side: dec.side,
        kind: dec.kind,
        signalTimeframe: dec.signal.timeframe,
        signalOpenTime: dec.signal.openTime,
        entryTime: nowMs,
        entryPrice: dec.refPrice,
        initialStop: dec.stop,
        stopSource: dec.stopSource,
        takeProfit: dec.takeProfit,
        trend1w: dec.trend1w,
        finalStop: dec.stop,
        stopMoves: 0,
      };
    } else if (dec.type === 'exit' && pos !== null) {
      // The exit candle is consumed: the opposite side may open on it only
      // through the flip (B7.4, B7.5), never as a plain entry later.
      seen.add(signalKey(strategy.id, dec.signal));
      trades.push(close(pos, nowMs, dec.refPrice, dec.reason));
      pos = null;
    } else if (dec.type === 'move_stop' && pos !== null) {
      pos = { ...pos, finalStop: dec.stop, stopMoves: pos.stopMoves + 1 };
    } else {
      const label = dec.type === 'none' ? `none:${dec.reason}` : dec.type;
      skipped[label] = (skipped[label] ?? 0) + 1;
    }
  }

  if (pos !== null) {
    const last = candles['4h'].filter((c) => c.closeTime < to).at(-1);
    trades.push(close(pos, null, last?.close ?? pos.entryPrice, 'open'));
  }

  const candleCounts = Object.fromEntries(TIMEFRAMES.map((tf) => [tf, candles[tf].length])) as Record<Timeframe, number>;
  const historyStart = Object.fromEntries(
    TIMEFRAMES.map((tf) => [tf, candles[tf][0]?.openTime ?? Number.NaN]),
  ) as Record<Timeframe, number>;

  return {
    pair,
    market,
    from,
    to,
    evaluations,
    trades,
    skipped,
    candleCounts,
    historyStart,
    historyGaps: TIMEFRAMES.flatMap((tf) => historyGaps(tf, candles[tf])),
  };
}
