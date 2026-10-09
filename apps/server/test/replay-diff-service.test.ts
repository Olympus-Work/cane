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
    // Rows without `input` (written before S13) and missing keys use the rebuilt position.
    expect(s.mismatches.map((m) => m.position)).toEqual(['rebuilt', 'rebuilt']);
  });

  it('marks a mismatch whose recorded input could not be read', async () => {
    const rows: LiveRow[] = [{ key: FIRST, decision: { type: 'none', reason: 'trend_filter', input: { position: { side: 'long', stop: 1 } } }, at: new Date(FIRST + H4 + 30_000) }];
    const out = await new ReplayDiffService(klines, fakeLive(rows)).run('2026-10-09', () => none);
    expect(out.strategies[0]!.mismatches[0]).toMatchObject({ outcome: 'differ', position: 'unreadable' });
  });

  it('uses the position the engine recorded (incl. none) before rebuilding it', async () => {
    const recorded = { side: 'short', kind: 'primary', stop: '90000', openedAt: 7 };
    const rows: LiveRow[] = [
      { key: FIRST, decision: { ...none, input: { position: recorded } }, at: new Date(FIRST + H4 + 30_000) },
      // Recorded "no position" wins even though the rebuild would find one.
      { key: FIRST + 3 * H4, decision: { ...none, input: { position: null } }, at: new Date(FIRST + 4 * H4 + 30_000) },
    ];
    const live = fakeLive(rows);
    const calls: DecideInput[] = [];
    await new ReplayDiffService(klines, live).run('2026-10-09', (input) => {
      calls.push(input);
      return none;
    });
    expect(calls[0]!.position).toMatchObject({ side: 'short', openedAt: 7 });
    expect(calls[0]!.position!.stop.toFixed()).toBe('90000');
    expect(calls[3]!.position).toBeNull();
    expect(live.positionAt).not.toHaveBeenCalledWith('S-01', rows[0]!.at);
  });

  it('does not count keys outside the managed period', async () => {
    const out = await new ReplayDiffService(klines, fakeLive([], false)).run('2026-10-09', () => none);
    expect(out.strategies[0]).toMatchObject({ compared: 0, matched: 0, mismatches: [] });
  });

  it('rejects a malformed day', async () => {
    await expect(new ReplayDiffService(klines, fakeLive([])).run('2026-13-40')).rejects.toThrow('Expected YYYY-MM-DD');
  });
});
