import { drizzle } from 'drizzle-orm/node-postgres';
import { Decimal } from 'decimal.js';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SettledFunding } from '@cane/core';
import type { FundingClient } from '../src/funding/funding.client.js';
import { FundingStore } from '../src/funding/funding.store.js';
import { FundingSync } from '../src/funding/funding.sync.js';
import { DATABASE_URL, freshDb } from './support/db.js';

const H = 60 * 60 * 1000;
const T0 = Date.UTC(2024, 0, 1);

/** Fake exchange: a fixed list of settled events, answered by range like /fapi/v1/fundingRate. */
class FakeFundingClient {
  calls: Array<[number, number]> = [];
  /** Rows `/fapi/v1/premiumIndex` (all symbols) announces; the sync only reads these two fields. */
  premiums: Array<{ symbol: string; nextFundingTime: number }> = [];
  /** Bulk settled page; null like the client's "page may be truncated" answer. */
  settled: Array<SettledFunding & { symbol: string }> | null = [];
  constructor(
    public events: SettledFunding[],
    private readonly nextFundingTime = 0,
    public info: Array<{ symbol: string; fundingIntervalHours: number }> = [],
  ) {}
  async fundingHistory(_symbol: string, from: number, to: number): Promise<SettledFunding[]> {
    this.calls.push([from, to]);
    return this.events.filter((e) => e.fundingTime >= from && e.fundingTime <= to);
  }
  async premiumIndex() {
    return { nextFundingTime: this.nextFundingTime };
  }
  async premiumIndexAll() {
    return this.premiums;
  }
  async settledAt(_slot: number) {
    return this.settled;
  }
  async fundingInfo() {
    return this.info;
  }
}

const ev = (h: number, rate = '0.0001'): SettledFunding => ({ fundingTime: T0 + h * H, rate: new Decimal(rate), markPrice: new Decimal('42000.5') });

describe.skipIf(!DATABASE_URL)('FundingSync on Postgres (plan F01)', () => {
  let pool: pg.Pool;
  let store: FundingStore;

  beforeAll(async () => {
    pool = await freshDb();
    store = new FundingStore(drizzle(pool));
  });

  beforeEach(async () => {
    await pool.query('delete from funding_rate');
  });

  afterAll(async () => {
    await pool.end();
  });

  const syncWith = (fake: FakeFundingClient) => new FundingSync(fake as unknown as FundingClient, store);

  it('backfills on the first run and adds nothing on the second', async () => {
    const fake = new FakeFundingClient([0, 8, 16, 24].map((h) => ev(h)));
    const sync = syncWith(fake);

    expect(await sync.sync('BTCUSDT', T0, T0 + 30 * H)).toEqual({ symbol: 'BTCUSDT', added: 4, newest: T0 + 24 * H });
    expect(await sync.sync('BTCUSDT', T0, T0 + 30 * H)).toEqual({ symbol: 'BTCUSDT', added: 0, newest: T0 + 24 * H });
    expect(fake.calls.at(-1)).toEqual([T0 + 24 * H + 1, T0 + 30 * H]);

    const rows = await store.range('BTCUSDT', T0, T0 + 30 * H);
    expect(rows.map((r) => [r.fundingTime, r.intervalHours, r.rate.toString(), r.markPrice?.toString()])).toEqual(
      [0, 8, 16, 24].map((h) => [T0 + h * H, 8, '0.0001', '42000.5']),
    );
  });

  it('stores an interval change on the new rows only', async () => {
    const fake = new FakeFundingClient([0, 8, 16].map((h) => ev(h)));
    const sync = syncWith(fake);
    await sync.sync('BTCUSDT', T0, T0 + 17 * H);
    fake.events.push(ev(20), ev(24));
    expect((await sync.sync('BTCUSDT', T0, T0 + 25 * H)).added).toBe(2);

    const rows = await store.range('BTCUSDT', T0, T0 + 25 * H);
    expect(rows.map((r) => r.intervalHours)).toEqual([8, 8, 8, 4, 4]);
  });

  it('fills history before the oldest stored event when the window grows', async () => {
    const fake = new FakeFundingClient([0, 8, 16, 24, 32].map((h) => ev(h)));
    const sync = syncWith(fake);
    await sync.sync('BTCUSDT', T0 + 16 * H, T0 + 33 * H);
    expect((await store.range('BTCUSDT', 0, T0 + 40 * H)).length).toBe(3);

    expect((await sync.sync('BTCUSDT', T0, T0 + 33 * H)).added).toBe(2);
    const rows = await store.range('BTCUSDT', 0, T0 + 40 * H);
    expect(rows.map((r) => [r.fundingTime, r.intervalHours])).toEqual([0, 8, 16, 24, 32].map((h) => [T0 + h * H, 8]));
  });

  it('re-reads the oldest stored interval once older history is filled in (PR #39 review)', async () => {
    const fake = new FakeFundingClient([0, 8, 16, 20, 24].map((h) => ev(h)));
    const sync = syncWith(fake);
    await sync.sync('BTCUSDT', T0 + 16 * H, T0 + 25 * H);
    expect((await store.oldest('BTCUSDT'))!.intervalHours).toBe(4); // read forward: 16h -> 20h

    expect((await sync.sync('BTCUSDT', T0, T0 + 25 * H)).added).toBe(2);
    const rows = await store.range('BTCUSDT', 0, T0 + 30 * H);
    expect(rows.map((r) => r.intervalHours)).toEqual([8, 8, 8, 4, 4]);
  });

  it('takes a lone first event interval from the next funding time', async () => {
    const fake = new FakeFundingClient([ev(0)], T0 + 4 * H);
    await syncWith(fake).sync('NEWUSDT', T0, T0 + H);
    expect((await store.newest('NEWUSDT'))!.intervalHours).toBe(4);
  });

  it('reads every next settlement time from one premiumIndexAll call', async () => {
    const fake = new FakeFundingClient([]);
    fake.premiums = [
      { symbol: 'BTCUSDT', nextFundingTime: T0 + 8 * H },
      { symbol: 'GONEUSDT', nextFundingTime: 0 },
    ];
    const times = await syncWith(fake).nextFundingTimes();
    expect(times.get('BTCUSDT')).toBe(T0 + 8 * H);
    expect(times.has('GONEUSDT')).toBe(false);
    expect(times.size).toBe(1);
  });

  it('groups a settledAt page by symbol and passes null through', async () => {
    const fake = new FakeFundingClient([]);
    fake.settled = [
      { ...ev(0), symbol: 'BTCUSDT' },
      { ...ev(8), symbol: 'BTCUSDT' },
      { ...ev(0), symbol: 'ETHUSDT' },
    ];
    const grouped = await syncWith(fake).settledAt(T0 + 8 * H);
    expect([...grouped!.keys()].sort()).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(grouped!.get('BTCUSDT')).toEqual([ev(0), ev(8)]);
    expect(grouped!.get('ETHUSDT')).toEqual([ev(0)]);

    fake.settled = null;
    expect(await syncWith(fake).settledAt(T0)).toBeNull();
  });

  it('keeps symbols apart', async () => {
    const fake = new FakeFundingClient([0, 8].map((h) => ev(h)));
    const sync = syncWith(fake);
    await sync.sync('BTCUSDT', T0, T0 + 9 * H);
    expect(await store.newest('ETHUSDT')).toBeNull();
  });

  it('reports a stored interval that differs from fundingInfo', async () => {
    const fake = new FakeFundingClient([0, 8].map((h) => ev(h)), 0, [
      { symbol: 'BTCUSDT', fundingIntervalHours: 4 },
      { symbol: 'XRPUSDT', fundingIntervalHours: 4 },
    ]);
    const sync = syncWith(fake);
    await sync.sync('BTCUSDT', T0, T0 + 9 * H);
    expect(await sync.intervalMismatches(['BTCUSDT', 'ETHUSDT'])).toEqual([
      'BTCUSDT: fundingInfo says 4h, stored history says 8h',
    ]);
  });

  it('appendSettled: nothing stored, nothing appended', async () => {
    const sync = syncWith(new FakeFundingClient([]));
    expect(await sync.appendSettled('BTCUSDT', [ev(0), ev(8)])).toBe(false);
    expect(await store.range('BTCUSDT', 0, T0 + 40 * H)).toHaveLength(0);
  });

  it('appendSettled: appends the event just after the newest, twice is a no-op', async () => {
    const sync = syncWith(new FakeFundingClient([ev(0), ev(8)]));
    await sync.sync('BTCUSDT', T0, T0 + 9 * H);

    expect(await sync.appendSettled('BTCUSDT', [ev(16)])).toBe(true);
    const rows = await store.range('BTCUSDT', 0, T0 + 40 * H);
    expect(rows.map((r) => [r.fundingTime, r.intervalHours])).toEqual([0, 8, 16].map((h) => [T0 + h * H, 8]));

    expect(await sync.appendSettled('BTCUSDT', [ev(16)])).toBe(true);
    expect(await store.range('BTCUSDT', 0, T0 + 40 * H)).toHaveLength(3);
  });

  it('appendSettled: refuses to append across a gap of more than one interval', async () => {
    const sync = syncWith(new FakeFundingClient([ev(0), ev(8)]));
    await sync.sync('BTCUSDT', T0, T0 + 9 * H);

    expect(await sync.appendSettled('BTCUSDT', [ev(32)])).toBe(false);
    const rows = await store.range('BTCUSDT', 0, T0 + 40 * H);
    expect(rows.map((r) => r.fundingTime)).toEqual([0, 8].map((h) => T0 + h * H));
  });
});
