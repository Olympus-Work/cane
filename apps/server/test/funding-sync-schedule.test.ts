import { describe, expect, it, vi } from 'vitest';
import { Decimal } from 'decimal.js';
import type { SettledFunding } from '@cane/core';
import type { FundingCandidateSource, FundingTarget, TargetOptions } from '../src/funding/funding.candidates.js';
import type { FundingSync } from '../src/funding/funding.sync.js';
import {
  ERROR_RETRY_MS,
  FundingSyncSchedule,
  GIVE_UP_MS,
  RETRY_MS,
  SETTLE_GRACE_MS,
  parseSyncCandidates,
  parseSyncEnv,
  parseSyncSymbols,
} from '../src/funding-sync-schedule/funding-sync.schedule.js';

const NOW = Date.UTC(2026, 9, 15, 8, 5);
const DAY = 24 * 60 * 60 * 1000;
const FROM = NOW - 30 * DAY;
const H1 = 60 * 60 * 1000;
const H8 = 8 * 60 * 60 * 1000;
const NEXT = Date.UTC(2026, 9, 15, 16); // next settlement announced by premiumIndex

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

describe('parseSyncCandidates', () => {
  it('is off when unset, empty or false', () => {
    expect(parseSyncCandidates(undefined)).toBe(false);
    expect(parseSyncCandidates('')).toBe(false);
    expect(parseSyncCandidates('false')).toBe(false);
  });

  it('is on only for true', () => {
    expect(parseSyncCandidates('true')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(() => parseSyncCandidates('yes')).toThrow(/FUNDING_SYNC_CANDIDATES/);
  });
});

describe('parseSyncEnv (PR 44 review: a bad value never stops the boot)', () => {
  it('returns the options for valid values', () => {
    expect(parseSyncEnv('BTCUSDT', 'true')).toEqual({ whitelist: ['BTCUSDT'], candidates: true });
    expect(parseSyncEnv(undefined, undefined)).toEqual({ whitelist: [], candidates: false });
  });

  it('returns an error instead of throwing on a bad value', () => {
    expect(parseSyncEnv(undefined, '1')).toEqual({ error: expect.stringMatching(/FUNDING_SYNC_CANDIDATES/) });
    expect(parseSyncEnv('btc', 'true')).toEqual({ error: expect.stringMatching(/FUNDING_SYNC_SYMBOLS/) });
  });
});

describe('FundingSyncSchedule (sync right after each settlement)', () => {
  const rowsOf = (slot: number): SettledFunding[] => [{ fundingTime: slot, rate: new Decimal('0.0001'), markPrice: null }];
  const settledMap = (slot: number, symbols: readonly string[]): Map<string, SettledFunding[]> =>
    new Map(symbols.map((symbol): [string, SettledFunding[]] => [symbol, rowsOf(slot)]));

  function setup(symbols: string[] = ['BTCUSDT']) {
    let now = NOW;
    const targets: FundingTarget[] = symbols.map((symbol) => ({ symbol, from: FROM, depthDays: 30, listedAt: null }));
    const next = new Map<string, number>(symbols.map((symbol) => [symbol, NEXT]));
    const sync = {
      sync: vi.fn(async (symbol: string, _from: number, _now: number) => ({ symbol, added: 0, newest: null })),
      nextFundingTimes: vi.fn(async () => next),
      settledAt: vi.fn(
        async (slot: number): Promise<Map<string, SettledFunding[]> | null> =>
          settledMap(slot, targets.map((t) => t.symbol)),
      ),
      appendSettled: vi.fn(async (_symbol: string, _settled: readonly SettledFunding[]) => true),
      intervalMismatches: vi.fn(async (_symbols: readonly string[]) => [] as string[]),
    };
    const source = { targets: vi.fn(async () => ({ targets, noSpot: [], unsupported: [] })) };
    const opts: TargetOptions = { whitelist: symbols, candidates: false };
    const schedule = new FundingSyncSchedule(
      sync as unknown as FundingSync,
      source as unknown as FundingCandidateSource,
      opts,
      () => now,
    );
    return { sync, source, schedule, targets, next, at: (ms: number) => (now = ms) };
  }

  it('syncs every new symbol once, fills the slots from one bulk call and cross-checks intervals', async () => {
    const { sync, schedule } = setup(['BTCUSDT', 'ETHUSDT']);
    await schedule.tick();
    expect(sync.sync.mock.calls).toEqual([
      ['BTCUSDT', FROM, NOW],
      ['ETHUSDT', FROM, NOW],
    ]);
    expect(sync.nextFundingTimes).toHaveBeenCalledTimes(1);
    expect(sync.settledAt).not.toHaveBeenCalled();
    expect(sync.intervalMismatches).toHaveBeenCalledWith(['BTCUSDT', 'ETHUSDT']);
    expect(schedule.slotOf('BTCUSDT')).toBe(NEXT);
    expect(schedule.slotOf('ETHUSDT')).toBe(NEXT);
  });

  it('waits for the announced settlement plus the grace period', async () => {
    const { sync, schedule, at } = setup();
    await schedule.tick();
    at(NEXT + SETTLE_GRACE_MS - 1);
    await schedule.tick();
    expect(sync.settledAt).not.toHaveBeenCalled();
    expect(sync.sync).toHaveBeenCalledTimes(1);
  });

  it('reads one bulk call for the due slot, appends it and refills the slots afterwards', async () => {
    const { sync, schedule, next, at } = setup(['BTCUSDT', 'ETHUSDT']);
    await schedule.tick();
    at(NEXT + SETTLE_GRACE_MS);
    await schedule.tick();
    expect(sync.settledAt.mock.calls).toEqual([[NEXT]]);
    expect(sync.appendSettled).toHaveBeenCalledWith('BTCUSDT', expect.any(Array));
    expect(sync.appendSettled).toHaveBeenCalledWith('ETHUSDT', expect.any(Array));
    expect(sync.sync).toHaveBeenCalledTimes(2); // no per-symbol re-sync
    expect(schedule.slotOf('BTCUSDT')).toBeNull();
    expect(schedule.slotOf('ETHUSDT')).toBeNull();
    next.set('BTCUSDT', NEXT + H8);
    next.set('ETHUSDT', NEXT + H8);
    at(NEXT + SETTLE_GRACE_MS + RETRY_MS);
    await schedule.tick();
    expect(schedule.slotOf('BTCUSDT')).toBe(NEXT + H8);
    expect(schedule.slotOf('ETHUSDT')).toBe(NEXT + H8);
  });

  it('falls back to a per-symbol sync when the append does not fit', async () => {
    const { sync, schedule, at } = setup(['BTCUSDT', 'ETHUSDT']);
    await schedule.tick();
    sync.appendSettled.mockImplementation(async (symbol: string) => symbol !== 'BTCUSDT');
    at(NEXT + SETTLE_GRACE_MS);
    await schedule.tick();
    expect(sync.sync).toHaveBeenCalledTimes(3);
    expect(sync.sync).toHaveBeenCalledWith('BTCUSDT', FROM, NEXT + SETTLE_GRACE_MS);
  });

  it('syncs every due symbol per-symbol when the bulk page is truncated', async () => {
    const { sync, schedule, at } = setup(['BTCUSDT', 'ETHUSDT']);
    await schedule.tick();
    sync.settledAt.mockResolvedValue(null);
    at(NEXT + SETTLE_GRACE_MS);
    await schedule.tick();
    expect(sync.appendSettled).not.toHaveBeenCalled();
    expect(sync.sync.mock.calls.slice(2)).toEqual([
      ['BTCUSDT', FROM, NEXT + SETTLE_GRACE_MS],
      ['ETHUSDT', FROM, NEXT + SETTLE_GRACE_MS],
    ]);
  });

  it('retries a symbol the bulk result does not carry, then gives up', async () => {
    const { sync, schedule, next, at } = setup(['BTCUSDT', 'ETHUSDT']);
    await schedule.tick();
    sync.settledAt.mockImplementation(async (slot: number) => settledMap(slot, ['ETHUSDT']));
    next.set('BTCUSDT', NEXT + H8); // neither symbol moves back onto the old slot
    next.set('ETHUSDT', NEXT + H8);
    at(NEXT + SETTLE_GRACE_MS);
    await schedule.tick();
    expect(schedule.slotOf('BTCUSDT')).toBe(NEXT); // kept: not published yet
    expect(schedule.slotOf('ETHUSDT')).toBeNull();
    at(NEXT + SETTLE_GRACE_MS + RETRY_MS);
    await schedule.tick();
    expect(sync.settledAt.mock.calls).toEqual([[NEXT], [NEXT]]); // one minute later, still only BTCUSDT due
    expect(sync.appendSettled).toHaveBeenCalledTimes(1); // ETHUSDT not touched again
    at(NEXT + GIVE_UP_MS);
    await schedule.tick();
    expect(schedule.slotOf('BTCUSDT')).toBeNull();
    expect(sync.sync).toHaveBeenCalledTimes(2); // giving up does not re-sync
    at(NEXT + GIVE_UP_MS + RETRY_MS);
    await schedule.tick();
    expect(sync.settledAt.mock.calls).toEqual([[NEXT], [NEXT], [NEXT]]); // no more retries for that slot
  });

  it('ignores a settlement it already finished when premiumIndex still announces it', async () => {
    const { sync, schedule, at } = setup();
    await schedule.tick();
    at(NEXT + SETTLE_GRACE_MS);
    await schedule.tick(); // NEXT synced; `next` still announces NEXT
    at(NEXT + SETTLE_GRACE_MS + RETRY_MS);
    await schedule.tick();
    expect(sync.settledAt.mock.calls).toEqual([[NEXT]]);
    expect(schedule.slotOf('BTCUSDT')).toBeNull();
  });

  it('makes one bulk call per distinct settlement slot', async () => {
    const { sync, schedule, next, at } = setup(['BTCUSDT', 'ETHUSDT']);
    const S1 = Date.UTC(2026, 9, 15, 12);
    const S2 = S1 + H1;
    next.set('BTCUSDT', S1);
    next.set('ETHUSDT', S2);
    await schedule.tick();
    at(S2 + SETTLE_GRACE_MS);
    await schedule.tick();
    expect(sync.settledAt.mock.calls).toEqual([[S1], [S2]]);
  });

  it('pauses the whole schedule after a failed request and never throws', async () => {
    const { sync, source, schedule, at } = setup(['BTCUSDT', 'ETHUSDT']);
    sync.sync.mockRejectedValueOnce(new Error('Funding rate request failed with status 503'));
    await expect(schedule.tick()).resolves.toBeUndefined();
    expect(schedule.pausedTill).toBe(NOW + ERROR_RETRY_MS);
    source.targets.mockClear();
    sync.sync.mockClear();
    at(NOW + ERROR_RETRY_MS - 1);
    await schedule.tick();
    expect(source.targets).not.toHaveBeenCalled();
    expect(sync.sync).not.toHaveBeenCalled();
    at(NOW + ERROR_RETRY_MS);
    await schedule.tick();
    expect(source.targets).toHaveBeenCalledTimes(1);
    expect(sync.sync).toHaveBeenCalledTimes(2);
  });

  it('forgets a delisted symbol and re-syncs it when it comes back', async () => {
    const { sync, schedule, targets, next, at } = setup(['BTCUSDT', 'ETHUSDT']);
    await schedule.tick();
    next.set('BTCUSDT', NEXT + H8);
    const eth = targets[1]!;
    targets.splice(1, 1); // delisted
    at(NEXT + SETTLE_GRACE_MS);
    await schedule.tick();
    expect(sync.sync).toHaveBeenCalledTimes(2); // ETHUSDT is not synced any more
    expect(schedule.slotOf('ETHUSDT')).toBeNull();
    targets.push(eth); // listed again
    at(NEXT + SETTLE_GRACE_MS + RETRY_MS);
    await schedule.tick();
    expect(sync.sync).toHaveBeenCalledTimes(3);
    expect(sync.sync).toHaveBeenLastCalledWith('ETHUSDT', eth.from, NEXT + SETTLE_GRACE_MS + RETRY_MS);
  });

  it('does not overlap a tick that is still running', async () => {
    const { sync, schedule } = setup();
    let release!: () => void;
    sync.sync.mockImplementationOnce(
      () => new Promise((r) => (release = () => r({ symbol: 'BTCUSDT', added: 0, newest: null }))),
    );
    const first = schedule.tick();
    await schedule.tick();
    expect(sync.sync).toHaveBeenCalledTimes(1);
    expect(sync.nextFundingTimes).not.toHaveBeenCalled();
    release();
    await first;
  });

  it('never polls a symbol with no announced next funding time', async () => {
    const { sync, schedule, next, at } = setup();
    next.delete('BTCUSDT');
    await schedule.tick();
    expect(schedule.slotOf('BTCUSDT')).toBeNull();
    at(NEXT + GIVE_UP_MS);
    await schedule.tick();
    expect(sync.settledAt).not.toHaveBeenCalled();
    expect(sync.sync).toHaveBeenCalledTimes(1);
  });
});
