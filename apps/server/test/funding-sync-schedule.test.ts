import { describe, expect, it, vi } from 'vitest';
import type { FundingSync } from '../src/funding/funding.sync.js';
import { FundingSyncSchedule, LIVE_HISTORY_DAYS, parseSyncSymbols } from '../src/funding-sync-schedule/funding-sync.schedule.js';

const NOW = Date.UTC(2026, 9, 15, 8, 5);
const DAY = 24 * 60 * 60 * 1000;

describe('parseSyncSymbols', () => {
  it('is off when unset or empty', () => {
    expect(parseSyncSymbols(undefined)).toEqual([]);
    expect(parseSyncSymbols(' ')).toEqual([]);
  });

  it('reads a comma list', () => {
    expect(parseSyncSymbols('BTCUSDT, ETHUSDT')).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('rejects an invalid symbol', () => {
    expect(() => parseSyncSymbols('BTCUSDT,eth')).toThrow(/eth/);
  });
});

describe('FundingSyncSchedule', () => {
  function fakeSync(overrides: Partial<Record<'sync' | 'intervalMismatches', ReturnType<typeof vi.fn>>> = {}) {
    return {
      sync: overrides.sync ?? vi.fn(async (symbol: string) => ({ symbol, added: 0, newest: null })),
      intervalMismatches: overrides.intervalMismatches ?? vi.fn(async () => []),
    };
  }

  it('syncs every symbol over the live history window, then cross-checks intervals', async () => {
    const sync = fakeSync();
    await new FundingSyncSchedule(sync as unknown as FundingSync, ['BTCUSDT', 'ETHUSDT'], () => NOW).tick();
    expect(sync.sync.mock.calls).toEqual([
      ['BTCUSDT', NOW - LIVE_HISTORY_DAYS * DAY, NOW],
      ['ETHUSDT', NOW - LIVE_HISTORY_DAYS * DAY, NOW],
    ]);
    expect(sync.intervalMismatches).toHaveBeenCalledWith(['BTCUSDT', 'ETHUSDT']);
  });

  it('keeps going after one symbol fails and never throws', async () => {
    const sync = fakeSync({
      sync: vi.fn().mockRejectedValueOnce(new Error('Funding rate request failed with status 503')).mockResolvedValue({ added: 1 }),
      intervalMismatches: vi.fn().mockRejectedValue(new Error('down')),
    });
    await expect(new FundingSyncSchedule(sync as unknown as FundingSync, ['BTCUSDT', 'ETHUSDT'], () => NOW).tick()).resolves.toBeUndefined();
    expect(sync.sync).toHaveBeenCalledTimes(2);
  });

  it('does not overlap a tick that is still running', async () => {
    let release!: () => void;
    const sync = fakeSync({ sync: vi.fn(() => new Promise((r) => (release = () => r({ added: 0 })))) });
    const schedule = new FundingSyncSchedule(sync as unknown as FundingSync, ['BTCUSDT'], () => NOW);
    const first = schedule.tick();
    await schedule.tick();
    release();
    await first;
    expect(sync.sync).toHaveBeenCalledTimes(1);
  });
});
