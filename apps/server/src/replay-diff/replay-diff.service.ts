import { Inject, Injectable } from '@nestjs/common';
import { TIMEFRAME_MS, analyzeTimeframe, decide, type Analyses, type Candle, type Timeframe } from '@cane/core';
import { KlineCache } from '../market-data/kline-cache.js';
import { classifyKey, type KeyDiff } from '../replay/diff.js';
import { LiveRecords, type DiffStrategy } from './live-records.js';

export const LIVE_RECORDS = Symbol('LIVE_RECORDS');

const H4 = TIMEFRAME_MS['4h'];
const DAY = 24 * 60 * 60 * 1000;
/** Live evaluates 30 s after a 4H close (engine EVALUATION_GRACE_MS); used when live has no row. */
const LIVE_GRACE_MS = 30_000;

export interface StrategyDiff {
  strategyId: string;
  pair: string;
  market: string;
  /** Keys compared (rows live recorded or was due to record). */
  compared: number;
  matched: number;
  /** Every key that is not a match. */
  mismatches: KeyDiff[];
}

export interface DayDiff {
  /** UTC day, YYYY-MM-DD: 4H evaluations at closes in [day 00:00, next day 00:00). */
  day: string;
  strategies: StrategyDiff[];
}

/** First 4H key evaluated in the UTC day starting at `dayStart`: the candle that closes at 00:00. */
export const firstKeyOf = (dayStart: number): number => dayStart - H4;

/**
 * Daily live == replay check (plan S13, AC3). For each 4H evaluation of the
 * day it re-runs core `decide` on public closed candles with the position
 * live held, and compares with live's recorded decision. Read-only: public
 * klines + the `cane_replay` DB user; no executor, no keys.
 */
@Injectable()
export class ReplayDiffService {
  constructor(
    private readonly klines: KlineCache,
    @Inject(LIVE_RECORDS) private readonly live: LiveRecords,
  ) {}

  async run(day: string, decideFn: typeof decide = decide): Promise<DayDiff> {
    const dayStart = Date.parse(`${day}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(dayStart)) throw new Error(`Expected YYYY-MM-DD, got "${day}"`);
    const fromKey = firstKeyOf(dayStart);
    const toKey = fromKey + DAY;
    const out: StrategyDiff[] = [];
    for (const s of await this.live.strategies(fromKey, toKey)) out.push(await this.diffStrategy(s, fromKey, toKey, decideFn));
    return { day, strategies: out };
  }

  private async diffStrategy(s: DiffStrategy, fromKey: number, toKey: number, decideFn: typeof decide): Promise<StrategyDiff> {
    const rows = new Map((await this.live.rows(s.id, fromKey, toKey)).map((r) => [r.key, r]));
    const result: StrategyDiff = { strategyId: s.id, pair: s.pair, market: s.market, compared: 0, matched: 0, mismatches: [] };
    for (let key = fromKey; key < toKey; key += H4) {
      const row = rows.get(key);
      const nowMs = key + H4; // the 4H close: the engine's evaluation time
      const at = row?.at ?? new Date(nowMs + LIVE_GRACE_MS);
      const load = (tf: Timeframe): Promise<Candle[]> => this.klines.closedCandles(s.market, s.pair, tf, nowMs);
      const [h4, d1, w1] = await Promise.all([load('4h'), load('1d'), load('1w')]);
      const analyses: Analyses = { '4h': analyzeTimeframe('4h', h4), '1d': analyzeTimeframe('1d', d1), '1w': analyzeTimeframe('1w', w1) };
      const position = await this.live.positionAt(s.id, at);
      const replay = decideFn({ strategy: { id: s.id, market: s.market }, analyses, position, nowMs });
      const around = row ? true : await this.live.hasRowsAround(s.id, key);
      const diff = classifyKey(key, row?.decision, replay, around);
      if (diff === null) continue;
      result.compared++;
      if (diff.outcome === 'match') result.matched++;
      else result.mismatches.push(diff);
    }
    return result;
  }
}
