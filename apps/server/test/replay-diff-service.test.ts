import { Decimal } from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import type { DecideInput, Decision } from '@cane/core';
import type { KlineCache } from '../src/market-data/kline-cache.js';
import type { LiveRecords, LiveRow } from '../src/replay-diff/live-records.js';
import { ReplayDiffService } from '../src/replay-diff/replay-diff.service.js';

const H4 = 4 * 60 * 60 * 1000;
const DAY = Date.parse('2026-10-09T00:00:00Z');
const FIRST = DAY - H4; // the 4H candle that closes at 00:00

function fakeLive(rows: LiveRow[], around = true): LiveRecords {
  return {
    strategies: vi.fn().mockResolvedValue([{ id: 'S-01', pair: 'BTCUSDT', market: 'futures' }]),
    rows: vi.fn().mockResolvedValue(rows),
    hasRowsAround: vi.fn().mockResolvedValue(around),
    positionAt: vi.fn(async (_id: string, at: Date) =>
      at.getTime() > FIRST + 2 * H4 + 31_000 ? { side: 'long', kind: 'primary', stop: new Decimal('80000'), openedAt: FIRST + 2 * H4 + 31_000 } : null,
    ),
  } as unknown as LiveRecords;
}

const klines = { closedCandles: vi.fn().mockResolvedValue([]) } as unknown as KlineCache;
const none: Decision = { type: 'none', reason: 'no_signal' };

describe('ReplayDiffService (plan S13)', () => {
  it('evaluates the six 4H closes of the UTC day at the engine time, with the live position', async () => {
    const rows: LiveRow[] = [0, 1, 2, 3, 4, 5].map((i) => ({ key: FIRST + i * H4, decision: none, at: new Date(FIRST + (i + 1) * H4 + 30_000) }));
    const calls: DecideInput[] = [];
    const decideFn = (input: DecideInput): Decision => {
      calls.push(input);
      return none;
    };
    const out = await new ReplayDiffService(klines, fakeLive(rows)).run('2026-10-09', decideFn);
    expect(calls.map((c) => c.nowMs)).toEqual([0, 1, 2, 3, 4, 5].map((i) => FIRST + (i + 1) * H4));
    expect(calls.map((c) => (c.position ? c.position.side : null))).toEqual([null, null, 'long', 'long', 'long', 'long']);
    expect(klines.closedCandles).toHaveBeenCalledWith('futures', 'BTCUSDT', '1w', FIRST + H4);
    expect(out).toEqual({
      day: '2026-10-09',
      strategies: [{ strategyId: 'S-01', pair: 'BTCUSDT', market: 'futures', compared: 6, matched: 6, mismatches: [] }],
    });
  });

  it('reports a differing decision and a missing live row inside a managed period', async () => {
    const rows: LiveRow[] = [0, 1, 3, 4, 5].map((i) => ({ key: FIRST + i * H4, decision: none, at: new Date(FIRST + (i + 1) * H4 + 30_000) }));
    rows[0] = { ...rows[0]!, decision: { type: 'none', reason: 'trend_filter' } };
    const out = await new ReplayDiffService(klines, fakeLive(rows)).run('2026-10-09', () => none);
    const s = out.strategies[0]!;
    expect(s.compared).toBe(6);
    expect(s.matched).toBe(4);
    expect(s.mismatches.map((m) => [m.key, m.outcome])).toEqual([
      [FIRST, 'differ'],
      [FIRST + 2 * H4, 'missing_live'],
    ]);
  });

  it('does not count keys outside the managed period', async () => {
    const out = await new ReplayDiffService(klines, fakeLive([], false)).run('2026-10-09', () => none);
    expect(out.strategies[0]).toMatchObject({ compared: 0, matched: 0, mismatches: [] });
  });

  it('rejects a malformed day', async () => {
    await expect(new ReplayDiffService(klines, fakeLive([])).run('2026-13-40')).rejects.toThrow('Expected YYYY-MM-DD');
  });
});
