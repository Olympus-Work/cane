import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApi, type Api } from './support/api.js';
import { DATABASE_URL } from './support/db.js';

const CANDLE = 1_893_456_000_000;

// The engine is off in this harness (no TRADING_ENABLED), so this covers the
// HTTP contract, the DB effects, the audit row and the status derivation
// (B11.1, B11.3, B11.5). Order sending is covered in kill-switch.test.ts.
describe.skipIf(!DATABASE_URL)('Kill switch API (S11, B11)', () => {
  let api: Api;
  const q = (text: string, params?: unknown[]) => api.pool.query(text, params);
  const status = async () => (await api.call('GET', '/v1/dashboard')).json().status as string;

  beforeAll(async () => {
    api = await bootApi(Date.parse('2030-01-01T12:00:00Z'));
    await q(
      `insert into strategies (id, pair, market, status, leverage, margin_mode) values
        ('S-01','BTCUSDT','futures','enabled',5,'isolated'),
        ('S-02','SOLUSDT','spot','disabled',null,null),
        ('S-03','XRPUSDT','spot','closed',null,null)`,
    );
    await q(
      `insert into positions (strategy_id, market, pair, side, status, entry_kind, signal_timeframe, signal_candle_open_time, qty, entry_price, stop_price, leverage, size_pct, opened_at)
       values ('S-01','futures','BTCUSDT','long','open','primary','1d',$1,'0.01','59000','58000',5,'10',now())`,
      [CANDLE],
    );
    // A futures position the system did not open: must be reported, never touched.
    api.exchange.snapshotValue = {
      ...api.exchange.snapshotValue,
      futuresPositions: [{ pair: 'ETHUSDT', amount: '2', entryPrice: '3000', markPrice: '3100', unrealizedPnl: '200', liquidationPrice: null }],
    };
  });

  afterAll(async () => {
    await api.close();
  });

  it('needs a session', async () => {
    expect((await api.call('POST', '/v1/kill-switch', { token: null })).statusCode).toBe(401);
    expect(await status()).toBe('running');
  });

  it('disables every open strategy, reports the position it could not close and the foreign one it left alone', async () => {
    const res = await api.call('POST', '/v1/kill-switch'); // session only: no TOTP code
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toEqual([{ pair: 'BTCUSDT', market: 'futures', what: expect.stringContaining('engine is off'), status: 'failed' }]);
    expect(body.untouched).toEqual([{ pair: 'ETHUSDT', market: 'futures' }]);
    expect(Number.isNaN(Date.parse(body.activatedAt))).toBe(false);

    const { rows } = await q('select id, status from strategies order by id');
    expect(rows).toEqual([
      { id: 'S-01', status: 'disabled' },
      { id: 'S-02', status: 'disabled' },
      { id: 'S-03', status: 'closed' },
    ]);
    const audit = await q("select actor, after from audit_log where action = 'kill_switch'");
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor).toBe('owner');
    expect(JSON.stringify(audit.rows[0].after)).not.toMatch(/secret|api.?key/i);
  });

  it('stays stopped_by_kill_switch until the first strategy is enabled again, then again after another kill', async () => {
    expect(await status()).toBe('stopped_by_kill_switch');
    const enabled = await api.call('POST', '/v1/strategies/S-02/enable', { code: api.freshCode() });
    expect(enabled.statusCode).toBe(200);
    expect(await status()).toBe('running');

    expect((await api.call('POST', '/v1/kill-switch')).statusCode).toBe(200);
    expect(await status()).toBe('stopped_by_kill_switch');
    expect((await q("select status from strategies where id = 'S-02'")).rows[0].status).toBe('disabled');
  });
});
