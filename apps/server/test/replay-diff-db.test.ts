import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LiveRecords } from '../src/replay-diff/live-records.js';
import { DATABASE_URL, freshDb } from './support/db.js';

const H4 = 4 * 60 * 60 * 1000;
const K = Date.parse('2026-10-09T00:00:00Z'); // a 4H key
const iso = (ms: number): string => new Date(ms).toISOString();

describe.skipIf(!DATABASE_URL)('replay-diff live records through the read-only user (plan S13)', () => {
  let admin: pg.Pool;
  let ro: pg.Pool;
  let live: LiveRecords;

  beforeAll(async () => {
    admin = await freshDb();
    await admin.query('drop role if exists cane_replay_test');
    await admin.query("create role cane_replay_test login password 'test-only' in role cane_readonly");
    const url = new URL(DATABASE_URL!);
    url.username = 'cane_replay_test';
    url.password = 'test-only';
    ro = new pg.Pool({ connectionString: url.toString() });
    live = new LiveRecords(drizzle(ro));

    await admin.query("insert into strategies(id, pair, market, status, leverage, margin_mode) values ('S-01', 'BTCUSDT', 'futures', 'enabled', 5, 'isolated')");
    await admin.query("insert into strategies(id, pair, market, status) values ('S-02', 'ETHUSDT', 'spot', 'disabled')");
    for (const [key, decision, at] of [
      [K - H4, { type: 'none', reason: 'no_signal' }, K + 30_000],
      [K, { type: 'enter', side: 'long' }, K + H4 + 30_000],
      [K + 2 * H4, { type: 'none', reason: 'no_signal' }, K + 3 * H4 + 30_000],
    ] as const) {
      await admin.query("insert into signals(strategy_id, timeframe, candle_open_time, decision, created_at) values ('S-01', '4h', $1, $2, $3)", [
        key,
        JSON.stringify(decision),
        iso(at),
      ]);
    }
    // 1D claim of the same entry: not a 4H row.
    await admin.query("insert into signals(strategy_id, timeframe, candle_open_time, decision) values ('S-01', '1d', $1, '{}')", [K]);
    // Entry filled 31 s after the K close; stop moved once at K + 3 x 4H; a rejected move after that.
    const { rows } = await admin.query<{ id: number }>(
      `insert into positions(strategy_id, market, pair, side, status, entry_kind, signal_timeframe, signal_candle_open_time,
                              qty, entry_price, stop_price, size_pct, opened_at)
       values ('S-01', 'futures', 'BTCUSDT', 'long', 'open', 'late', '1d', $1, '0.01', '84000', '82000', '10', $2) returning id`,
      [K, iso(K + H4 + 31_000)],
    );
    const pos = rows[0]!.id;
    const stop = async (cid: string, price: string, status: string, at: number) =>
      admin.query(
        `insert into orders(strategy_id, position_id, client_order_id, market, pair, side, type, purpose, status, qty, stop_price, created_at)
         values ('S-01', $1, $2, 'futures', 'BTCUSDT', 'SELL', 'STOP_MARKET', 'stop', $3, '0.01', $4, $5)`,
        [pos, cid, status, price, iso(at)],
      );
    await stop('S-01-a-stop', '80000', 'CANCELED', K + H4 + 32_000);
    await stop('S-01-b-trail', '81000', 'NEW', K + 3 * H4 + 31_000);
    await stop('S-01-c-trail', '81500', 'REJECTED', K + 4 * H4 + 31_000);
  });

  afterAll(async () => {
    await ro?.end();
    await admin?.query('drop role if exists cane_replay_test');
    await admin?.end();
  });

  it('cannot write: INSERT through the read-only user is denied', async () => {
    await expect(ro.query("insert into signals(strategy_id, timeframe, candle_open_time, decision) values ('S-01', '4h', 1, '{}')")).rejects.toThrow(
      /permission denied/,
    );
  });

  it('cannot read settings or auth tables', async () => {
    await expect(ro.query('select * from settings')).rejects.toThrow(/permission denied/);
    await expect(ro.query('select * from owner')).rejects.toThrow(/permission denied/);
  });

  it('lists strategies evaluated in the window plus the managed ones', async () => {
    expect((await live.strategies(K, K + 6 * H4)).map((s) => s.id)).toEqual(['S-01']);
    expect(await live.strategies(K + 100 * H4, K + 106 * H4)).toEqual([{ id: 'S-01', pair: 'BTCUSDT', market: 'futures' }]);
  });

  it('returns 4H rows only, in key order, with the claim time', async () => {
    const rows = await live.rows('S-01', K - H4, K + 6 * H4);
    expect(rows.map((r) => r.key)).toEqual([K - H4, K, K + 2 * H4]);
    expect(rows[1]!.decision).toEqual({ type: 'enter', side: 'long' });
    expect(rows[1]!.at.getTime()).toBe(K + H4 + 30_000);
  });

  it('knows whether live rows exist around a key', async () => {
    expect(await live.hasRowsAround('S-01', K + H4)).toBe(true);
    expect(await live.hasRowsAround('S-01', K + 3 * H4)).toBe(false); // after the last row
    expect(await live.hasRowsAround('S-01', K - 2 * H4)).toBe(false); // before the first row
  });

  it('rebuilds the position and the stop in force at each evaluation', async () => {
    expect(await live.positionAt('S-01', new Date(K + H4 + 30_000))).toBeNull(); // decided before the fill
    const afterEntry = await live.positionAt('S-01', new Date(K + 2 * H4 + 30_000));
    expect(afterEntry).toMatchObject({ side: 'long', kind: 'late', openedAt: K + H4 + 31_000 });
    expect(afterEntry!.stop.toFixed()).toBe('80000');
    const afterMove = await live.positionAt('S-01', new Date(K + 4 * H4 + 30_000));
    expect(afterMove!.stop.toFixed()).toBe('81000');
    // A rejected stop never protected the position.
    const afterRejected = await live.positionAt('S-01', new Date(K + 5 * H4 + 30_000));
    expect(afterRejected!.stop.toFixed()).toBe('81000');
  });
});
