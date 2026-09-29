import { Logger } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import {
  TIMEFRAME_MS,
  analyzeTimeframe,
  confluenceFeatures,
  decide,
  decideFlip,
  lastClosedIndex,
  primaryStop,
  type Analyses,
  type Candle,
  type Market,
  type OpenPosition,
  type Side,
  type Timeframe,
} from '@cane/core';
import type { Executor } from './executor.js';
import type { JevCall, JevClassifier } from './ports.js';
import type { EngineStore, PositionRow, StrategyRow } from './store.js';

/** Closed candles of one timeframe up to `nowMs` (the replay's KlineCache in production). */
export type CandleSource = (market: Market, pair: string, tf: Timeframe, nowMs: number) => Promise<Candle[]>;

/** Wait after a 4H close before evaluating, so Binance has finalised the kline (plan S06). */
export const EVALUATION_GRACE_MS = 30_000;

const H4 = TIMEFRAME_MS['4h'];

/** Open time of the newest 4H candle that closed at least the grace period before `now`. */
export function evaluatedCandle(now: number): number {
  return Math.floor((now - EVALUATION_GRACE_MS) / H4) * H4 - H4;
}

/** Runs one async job per key at a time (engine tick, reconciler and stream events share it). */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, job: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(job, job);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}

export interface EngineDeps {
  store: EngineStore;
  executor: Executor;
  candles: CandleSource;
  jev: JevClassifier;
  mutex: KeyedMutex;
  now: () => number;
  /** Test seam; production always uses core `decide`. */
  decideFn?: typeof decide;
}

/**
 * The live decision loop (B1). Once per closed 4H candle per strategy it
 * runs the same pure `decide` as the replay, at the same evaluation time
 * (the 4H close), and hands the result to the executor.
 */
export class Engine {
  private readonly log = new Logger('Engine');

  constructor(private readonly d: EngineDeps) {}

  /** One scheduler tick: evaluate every managed strategy for the newest closed 4H candle. */
  async tick(): Promise<void> {
    const key = evaluatedCandle(this.d.now());
    for (const s of await this.d.store.managedStrategies()) {
      try {
        await this.d.mutex.run(s.id, () => this.evaluate(s.id, key));
      } catch (err) {
        this.log.error(`${s.id} evaluation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /** Evaluates one strategy for the 4H candle opening at `key` (at most once, B1.2). */
  async evaluate(strategyId: string, key: number): Promise<void> {
    const s = await this.d.store.strategy(strategyId);
    if (!s) return;
    const nowMs = key + H4; // the 4H close: the replay's evaluation time
    const load = (tf: Timeframe) => this.d.candles(s.market, s.pair, tf, nowMs);
    const [h4, d1, w1] = await Promise.all([load('4h'), load('1d'), load('1w')]);
    const candles: Record<Timeframe, Candle[]> = { '4h': h4, '1d': d1, '1w': w1 };
    const analyses: Analyses = {
      '4h': analyzeTimeframe('4h', candles['4h']),
      '1d': analyzeTimeframe('1d', candles['1d']),
      '1w': analyzeTimeframe('1w', candles['1w']),
    };
    const p = await this.d.store.openPosition(s.id);
    const position: OpenPosition | null = p
      ? { side: p.side, kind: p.entryKind === 'late' ? 'late' : 'primary', stop: new Decimal(p.stopPrice), openedAt: p.openedAt.getTime() }
      : null;
    const dec = (this.d.decideFn ?? decide)({ strategy: { id: s.id, market: s.market }, analyses, position, nowMs });

    // E4: a missing candle is retried on the next tick instead of being recorded.
    if (dec.type === 'none' && dec.reason === 'data_gap') return;
    const signalId = await this.d.store.claimSignal(s.id, '4h', key, dec);
    if (signalId === null) return;

    if (dec.type === 'enter') {
      if (s.status !== 'enabled') return; // needs_attention / disabled: no new entries (B10.4, B12.2)
      // A 1D signal is used once: an entry skipped or closed on it is not retried later (B7.4).
      if (dec.signal.timeframe === '1d' && (await this.d.store.claimSignal(s.id, '1d', dec.signal.openTime, dec)) === null) return;
      const jev = dec.kind === 'primary' ? await this.classify(candles['1d'], nowMs, dec.side) : null; // B4.4: late = base size
      await this.d.executor.enter(s, {
        key,
        signalId,
        side: dec.side,
        kind: dec.kind,
        signalTimeframe: dec.signal.timeframe,
        signalOpenTime: dec.signal.openTime,
        refPrice: dec.refPrice,
        stop: dec.stop,
        takeProfit: dec.takeProfit,
        trend1w: dec.trend1w,
        jev,
      });
    } else if (dec.type === 'exit' && p) {
      await this.d.store.claimSignal(s.id, '1d', dec.signal.openTime, dec); // consumes the candle (B7.4)
      const pnl = await this.d.executor.exit(s, p, dec.reason, key, 'exit', signalId);
      if (pnl) await this.maybeFlip(s, p, dec.reason, pnl.netPnl, analyses, candles['1d'], nowMs, key, signalId, dec.signal.openTime);
    } else if (dec.type === 'move_stop' && p) {
      await this.d.executor.moveStop(s, p, dec.stop, key);
    }
  }

  /** B7.5: after a profitable futures exit on the opposite 1D signal, maybe open the other side. */
  private async maybeFlip(
    s: StrategyRow,
    closed: PositionRow,
    reason: 'first_red' | 'first_green',
    netPnl: Decimal,
    analyses: Analyses,
    candles1d: Candle[],
    nowMs: number,
    key: number,
    signalId: number,
    signalOpenTime: number,
  ): Promise<void> {
    if (s.market !== 'futures' || s.status !== 'enabled' || !netPnl.gt(0)) return;
    const side: Side = closed.side === 'long' ? 'short' : 'long';
    const jev = await this.classify(candles1d, nowMs, side);
    const flip = decideFlip({
      market: s.market,
      closedSide: closed.side,
      exitReason: reason,
      realisedPnl: netPnl,
      jev: jev.result,
      threshold: Number(s.confidenceThreshold),
    });
    if (!flip.flip) {
      this.log.log(`${s.id} no flip: ${flip.reason}`);
      return;
    }
    const ps = primaryStop(analyses['1d'], nowMs, side); // B5.2 on the same candle, no 1W filter
    if (!ps) return;
    await this.d.executor.enter(s, {
      key,
      signalId,
      side,
      kind: 'flip',
      signalTimeframe: '1d',
      signalOpenTime,
      refPrice: ps.refPrice,
      stop: ps.stop,
      takeProfit: null,
      trend1w: null,
      jev,
    });
  }

  /** B8: Jev classification of the last closed 1D candle for `side` (fallback handled by the executor). */
  private async classify(candles1d: Candle[], nowMs: number, side: Side): Promise<JevCall> {
    const features = confluenceFeatures(candles1d, lastClosedIndex(candles1d, nowMs), side);
    return this.d.jev.classify({ side, timeframe: '1d', features });
  }
}
