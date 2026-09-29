import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from '../src/db/migrate.js';

const url = process.env.DATABASE_URL;

it('has DATABASE_URL in CI', () => {
  if (process.env.CI) expect(url).toBeTruthy();
});

describe.skipIf(!url)('db migrations (fresh database)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    for (const sql of [
      'drop schema if exists drizzle cascade',
      'drop schema public cascade',
      'create schema public',
      'drop role if exists cane_readonly',
      'drop role if exists cane_app',
    ]) {
      await pool.query(sql);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  async function tables(): Promise<string[]> {
    const { rows } = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name asc",
    );
    return rows.map((r) => r.table_name);
  }

  async function count(sql: string): Promise<number> {
    const { rows } = await pool.query<{ n: number }>(sql);
    return rows[0]!.n;
  }

  async function asRole(role: string, sql: string): Promise<pg.QueryResult> {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`set local role ${role}`);
      return await client.query(sql);
    } finally {
      await client.query('rollback');
      client.release();
    }
  }

  async function expectPgError(p: Promise<unknown>, code: string): Promise<void> {
    await expect(p).rejects.toMatchObject({ code });
  }

  it('up creates all tables', async () => {
    await migrateUp(pool);
    expect(await tables()).toEqual([
      'audit_log',
      'candles',
      'jev_calls',
      'notifications',
      'orders',
      'owner',
      'positions',
      'recovery_codes',
      'sessions',
      'settings',
      'signals',
      'strategies',
      'trades',
    ]);
    expect(await count('select count(*)::int as n from drizzle.__drizzle_migrations')).toBe(3);
  });

  it('up again is a no-op', async () => {
    await migrateUp(pool);
    expect(await count('select count(*)::int as n from drizzle.__drizzle_migrations')).toBe(3);
  });

  it('signals are idempotent per strategy, timeframe and candle', async () => {
    await pool.query(
      "insert into strategies(id, pair, market, leverage, margin_mode) values ('S-01','BTCUSDT','futures',5,'isolated')",
    );
    await pool.query(
      "insert into signals(strategy_id, timeframe, candle_open_time, decision) values ('S-01','1d',1727740800000,'{}')",
    );
    await expectPgError(
      pool.query(
        "insert into signals(strategy_id, timeframe, candle_open_time, decision) values ('S-01','1d',1727740800000,'{}')",
      ),
      '23505',
    );
  });

  it('one active strategy per pair', async () => {
    await pool.query("update strategies set status = 'enabled' where id = 'S-01'");
    await expectPgError(
      pool.query(
        "insert into strategies(id, pair, market, status) values ('S-02','BTCUSDT','spot','enabled')",
      ),
      '23505',
    );
    await pool.query(
      "insert into strategies(id, pair, market, status) values ('S-02','BTCUSDT','spot','disabled')",
    );
  });

  it('rejects invalid rows', async () => {
    await expectPgError(
      pool.query(
        "insert into strategies(id, pair, market, leverage, margin_mode) values ('S-03','ETHUSDT','futures',25,'isolated')",
      ),
      '23514',
    );
    await expectPgError(
      pool.query(
        "insert into strategies(id, pair, market, leverage, margin_mode) values ('S-04','ETHBTC','futures',5,'isolated')",
      ),
      '23514',
    );
    const longOrderId = 'S-01-1727740800000-entry-' + 'x'.repeat(20);
    await expectPgError(
      pool.query(
        `insert into orders(strategy_id, client_order_id, market, pair, side, type, purpose, status, qty)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        ['S-01', longOrderId, 'futures', 'BTCUSDT', 'BUY', 'MARKET', 'entry', 'NEW', '0.01'],
      ),
      '23514',
    );
    await expectPgError(
      pool.query("insert into owner(id, email, password_hash) values (2, 'a@example.com', 'x')"),
      '23514',
    );
    await pool.query(
      `insert into orders(strategy_id, client_order_id, market, pair, side, type, purpose, status, qty)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      ['S-01', 'S-01-1727740800000-entry', 'futures', 'BTCUSDT', 'BUY', 'MARKET', 'entry', 'NEW', '0.01'],
    );
  });

  it('audit_log is append-only', async () => {
    await pool.query("insert into audit_log(actor, action) values ('owner','login_success')");
    await expect(pool.query('update audit_log set actor = \'x\'')).rejects.toThrow(/append-only/);
    await expect(pool.query('delete from audit_log')).rejects.toThrow(/append-only/);
    await expect(pool.query('truncate audit_log')).rejects.toThrow(/append-only/);
  });

  it('cane_app cannot rewrite the audit log', async () => {
    await asRole('cane_app', "insert into audit_log(actor, action) values ('system','x')");
    await expectPgError(asRole('cane_app', "update audit_log set actor = 'y'"), '42501');
    await expectPgError(asRole('cane_app', 'delete from audit_log'), '42501');
    await asRole('cane_app', 'select * from settings');
  });

  it('cane_readonly can only read trading records', async () => {
    await asRole('cane_readonly', 'select * from strategies');
    await expectPgError(
      asRole(
        'cane_readonly',
        "insert into candles(market, pair, timeframe, open_time, close_time, open, high, low, close, volume) values ('spot','BTCUSDT','1d',0,1,'1','1','1','1','1')",
      ),
      '42501',
    );
    await expectPgError(asRole('cane_readonly', 'select * from settings'), '42501');
    await expectPgError(asRole('cane_readonly', 'select * from owner'), '42501');
  });

  it('down reverts everything', async () => {
    await migrateDown(pool);
    expect(await tables()).toEqual([]);
    expect(await count("select count(*)::int as n from pg_roles where rolname in ('cane_app','cane_readonly')")).toBe(0);
    expect(await count("select count(*)::int as n from pg_proc where proname = 'audit_log_append_only'")).toBe(0);
    expect(await count('select count(*)::int as n from drizzle.__drizzle_migrations')).toBe(0);
  });

  it('up works again after down', async () => {
    await migrateUp(pool);
    expect((await tables()).length).toBe(13);
  });
});
