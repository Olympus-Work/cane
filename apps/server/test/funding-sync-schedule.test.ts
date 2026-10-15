import { describe, expect, it, vi } from 'vitest';
import type { FundingSync } from '../src/funding/funding.sync.js';
import {
  ERROR_RETRY_MS,
  FundingSyncSchedule,
  GIVE_UP_MS,
  LIVE_HISTORY_DAYS,
  RETRY_MS,
  SETTLE_GRACE_MS,
  parseSyncSymbols,
} from '../src/funding-sync-schedule/funding-sync.schedule.js';

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

describe('FundingSyncSchedule (sync right after each settlement)', () => {
  const H8 = 8 * 60 * 60 * 1000;
  const NEXT = Date.UTC(2026, 9, 15, 16); // next settlement announced by premiumIndex

  function setup(symbols = ['BTCUSDT']) {
    let now = NOW;
    let newest: number | null = Date.UTC(2026, 9, 15, 8);
    const sync = {
      sync: vi.fn(async (symbol: string) => ({ symbol, added: 0, newest })),
      nextFundingTime: vi.fn(async () => NEXT),
      intervalMismatches: vi.fn(async () => [] as string[]),
    };
    const schedule = new FundingSyncSchedule(sync as unknown as FundingSync, symbols, () => now);
    return {
      sync,
      schedule,
      at: (ms: number) => (now = ms),
      publish: (ms: number) => (newest = ms),
    };
  }

  it('syncs every symbol at start over the live history window, then cross-checks intervals', async () => {
    const { sync, schedule } = setup(['BTCUSDT', 'ETHUSDT']);
    await schedule.tick();
    expect(sync.sync.mock.calls).toEqual([
      ['BTCUSDT', NOW - LIVE_HISTORY_DAYS * DAY, NOW],
      ['ETHUSDT', NOW - LIVE_HISTORY_DAYS * DAY, NOW],
    ]);
    expect(sync.intervalMismatches).toHaveBeenCalledWith(['BTCUSDT', 'ETHUSDT']);
    expect(schedule.dueAt('BTCUSDT')).toBe(NEXT + SETTLE_GRACE_MS);
  });

  it('waits for the announced settlement plus the grace period', async () => {
    const { sync, schedule, at } = setup();
    await schedule.tick();
    at(NEXT + SETTLE_GRACE_MS - 1);
    await schedule.tick();
    expect(sync.sync).toHaveBeenCalledTimes(1);
    expect(sync.intervalMismatches).toHaveBeenCalledTimes(1);
  });

  it('syncs right after the settlement and moves to the next one', async () => {
    const { sync, schedule, at, publish } = setup();
    await schedule.tick();
    publish(NEXT);
    sync.nextFundingTime.mockResolvedValue(NEXT + H8);
    at(NEXT + SETTLE_GRACE_MS);
    await schedule.tick();
    expect(sync.sync).toHaveBeenCalledTimes(2);
    expect(schedule.dueAt('BTCUSDT')).toBe(NEXT + H8 + SETTLE_GRACE_MS);
  });

  it('retries every minute until the settlement is published', async () => {
    const { sync, schedule, at, publish } = setup();
    await schedule.tick();
    at(NEXT + SETTLE_GRACE_MS);
    await schedule.tick(); // not published yet
    expect(schedule.dueAt('BTCUSDT')).toBe(NEXT + SETTLE_GRACE_MS + RETRY_MS);
    expect(sync.nextFundingTime).toHaveBeenCalledTimes(1);
    publish(NEXT);
    sync.nextFundingTime.mockResolvedValue(NEXT + H8);
    at(NEXT + SETTLE_GRACE_MS + RETRY_MS);
    await schedule.tick();
    expect(schedule.dueAt('BTCUSDT')).toBe(NEXT + H8 + SETTLE_GRACE_MS);
  });

  it('gives up on a settlement after 30 minutes and moves on', async () => {
    const { sync, schedule, at } = setup();
    await schedule.tick();
    sync.nextFundingTime.mockResolvedValue(NEXT + H8);
    at(NEXT + GIVE_UP_MS);
    await schedule.tick();
    expect(schedule.dueAt('BTCUSDT')).toBe(NEXT + H8 + SETTLE_GRACE_MS);
  });

  it('backs off after a failure, keeps going with other symbols and never throws', async () => {
    const { sync, schedule } = setup(['BTCUSDT', 'ETHUSDT']);
    sync.sync.mockRejectedValueOnce(new Error('Funding rate request failed with status 503'));
    sync.intervalMismatches.mockRejectedValue(new Error('down'));
    await expect(schedule.tick()).resolves.toBeUndefined();
    expect(sync.sync).toHaveBeenCalledTimes(2);
    expect(schedule.dueAt('BTCUSDT')).toBe(NOW + ERROR_RETRY_MS);
    expect(schedule.dueAt('ETHUSDT')).toBe(NEXT + SETTLE_GRACE_MS);
  });

  it('does not overlap a tick that is still running', async () => {
    const { sync, schedule } = setup();
    let release!: () => void;
    sync.sync.mockImplementationOnce(() => new Promise((r) => (release = () => r({ symbol: 'BTCUSDT', added: 0, newest: null }))));
    const first = schedule.tick();
    await schedule.tick();
    release();
    await first;
    expect(sync.sync).toHaveBeenCalledTimes(1);
  });
});
