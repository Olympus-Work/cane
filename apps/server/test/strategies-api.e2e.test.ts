import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ExchangeReadError } from '../src/exchange/exchange-reader.js';
import { DATABASE_URL } from './support/db.js';
import { bootApi, type Api } from './support/api.js';

describe.skipIf(!DATABASE_URL)('Strategy API (S09.5, B10)', () => {
  let api: Api;
  let pool: pg.Pool;

  beforeAll(async () => {
    api = await bootApi(Date.parse('2030-01-01T12:00:00Z'));
    pool = api.pool;
  });

  afterAll(async () => {
    await api.close();
  });

  /** Insert an open position for a strategy (B10.7 lock tests, B10.5 close tests). */
  const insertOpenPosition = async (strategyId: string) => {
    await pool.query(
      `insert into positions (strategy_id, market, pair, side, status, entry_kind, signal_timeframe, signal_candle_open_time, qty, entry_price, stop_price, leverage, size_pct, opened_at)
       values ($1, 'futures', 'BTCUSDT', 'long', 'open', 'primary', '1d', 1893456000000, 0.01, 59000, 58000, 5, 10, now())`,
      [strategyId],
    );
  };

  /** Insert a live (NEW) order for a strategy (B10.5 orders_open test). */
  const insertLiveOrder = async (strategyId: string) => {
    await pool.query(
      `insert into orders (strategy_id, client_order_id, market, pair, side, type, purpose, status, qty)
       values ($1, $2, 'futures', 'BTCUSDT', 'BUY', 'MARKET', 'entry', 'NEW', 1)`,
      [strategyId, `${strategyId}-1-entry`],
    );
  };

  const strategyCount = async () => Number((await pool.query('select count(*)::int as n from strategies')).rows[0].n);

  it('1. every strategy route is 401 without a session', async () => {
    const calls: Array<['GET' | 'POST' | 'PATCH', string, object | undefined]> = [
      ['POST', '/v1/strategies', { pair: 'BTCUSDT' }],
      ['PATCH', '/v1/strategies/S-01', { basePct: 12 }],
      ['POST', '/v1/strategies/S-01/close', undefined],
      ['GET', '/v1/strategies', undefined],
      ['GET', '/v1/strategies/sizing-preview', undefined],
      ['GET', '/v1/trades', undefined],
      ['GET', '/v1/trades/1', undefined],
      ['GET', '/v1/audit-log', undefined],
      ['GET', '/v1/dashboard', undefined],
      ['GET', '/v1/dashboard/heatmap', undefined],
    ];
    for (const [method, url, body] of calls) {
      const res = await api.call(method, url, { token: null, ...(body === undefined ? {} : { body }) });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('2. create applies the B10.1 defaults and audits strategy_create', async () => {
    const res = await api.call('POST', '/v1/strategies', { body: { pair: 'btcusdt' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: 'S-01', status: 'disabled' });

    const rows = (await pool.query('select * from strategies where id = $1', ['S-01'])).rows;
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.pair).toBe('BTCUSDT');
    expect(row.market).toBe('futures');
    expect(row.leverage).toBe(5);
    expect(row.margin_mode).toBe('isolated');
    expect(row.sizing_mode).toBe('B');
    expect(Number(row.base_pct)).toBe(10);
    expect(Number(row.confidence_threshold)).toBe(0.7);
    expect(row.risk_pct).toBeNull();
    expect(row.status).toBe('disabled');

    const audit = (await pool.query(`select * from audit_log where action = 'strategy_create' and target = 'S-01'`)).rows;
    expect(audit).toHaveLength(1);
  });

  it('3. create a spot strategy: no leverage, no margin mode', async () => {
    const res = await api.call('POST', '/v1/strategies', { body: { pair: 'ETHUSDT', market: 'spot' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: 'S-02', status: 'disabled' });
    const rows = (await pool.query('select * from strategies where id = $1', ['S-02'])).rows;
    expect(rows[0].market).toBe('spot');
    expect(rows[0].leverage).toBeNull();
    expect(rows[0].margin_mode).toBeNull();
  });

  it('4. parallel creates get distinct ids, no 500', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => api.call('POST', '/v1/strategies', { body: { pair: 'BTCUSDT' } })));
    expect(results.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201]);
    const ids = results.map((r) => r.json().id as string).sort();
    expect(ids).toEqual(['S-03', 'S-04', 'S-05', 'S-06', 'S-07']);
    expect(new Set(ids).size).toBe(5);
  });

  it('5. bad bodies are 400 with a code and create no row', async () => {
    const cases: Array<[object, string]> = [
      [{ pair: 'BTCUSDT', market: 'spot', leverage: 3 }, 'spot_no_leverage'],
      [{ pair: 'BTCUSDT', basePct: 25 }, 'bad_basePct'],
      [{ pair: 'BTCUSDT', leverage: 21 }, 'bad_leverage'],
      [{ pair: 'BTCUSDT', sizingMode: 'C', riskPct: 0 }, 'bad_riskPct'],
      [[1, 2, 3], 'bad_body'],
    ];
    for (const [body, code] of cases) {
      const res = await api.call('POST', '/v1/strategies', { body });
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toMatchObject({ code });
    }
    expect(await strategyCount()).toBe(7);
  });

  it('6. B10.6: unlisted pair is 400, unreachable exchange is 503', async () => {
    const unlisted = await api.call('POST', '/v1/strategies', { body: { pair: 'DOGEUSDT' } });
    expect(unlisted.statusCode).toBe(400);
    expect(unlisted.json()).toMatchObject({ code: 'pair_not_listed' });

    api.exchange.failWith = new ExchangeReadError('unreachable', 'x');
    try {
      const res = await api.call('POST', '/v1/strategies', { body: { pair: 'BTCUSDT' } });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ code: 'exchange_unreachable' });
    } finally {
      api.exchange.failWith = null;
    }
    expect(await strategyCount()).toBe(7);
  });

  it('7. edit without a position: applies, audits, rejects unknown field and bad leverage', async () => {
    const res = await api.call('PATCH', '/v1/strategies/S-01', { body: { basePct: 15, leverage: 10 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'S-01', basePct: '15', leverage: 10 });
    const row = (await pool.query('select * from strategies where id = $1', ['S-01'])).rows[0];
    expect(Number(row.base_pct)).toBe(15);
    expect(row.leverage).toBe(10);
    const audit = (await pool.query(`select * from audit_log where action = 'strategy_edit' and target = 'S-01'`)).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].before).toMatchObject({ basePct: '10' });
    expect(audit[0].after).toMatchObject({ basePct: '15' });

    const unknown = await api.call('PATCH', '/v1/strategies/S-01', { body: { status: 'enabled' } });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toMatchObject({ code: 'unknown_field' });

    const badLev = await api.call('PATCH', '/v1/strategies/S-01', { body: { leverage: 0 } });
    expect(badLev.statusCode).toBe(400);
    expect(badLev.json()).toMatchObject({ code: 'bad_leverage' });

    const missing = await api.call('PATCH', '/v1/strategies/S-99', { body: { basePct: 12 } });
    expect(missing.statusCode).toBe(404);
  });

  it('8. B10.7: pair, market, leverage and margin mode are locked with an open position', async () => {
    await insertOpenPosition('S-01');

    for (const [body, field] of [
      [{ leverage: 3 }, 'leverage'],
      [{ marginMode: 'cross' }, 'marginMode'],
      [{ pair: 'ETHUSDT' }, 'pair'],
    ] as const) {
      const res = await api.call('PATCH', '/v1/strategies/S-01', { body: { ...body } });
      expect(res.statusCode, JSON.stringify(body)).toBe(409);
      expect(res.json()).toMatchObject({ code: 'locked_field', field });
    }

    const same = await api.call('PATCH', '/v1/strategies/S-01', { body: { leverage: 10 } });
    expect(same.statusCode).toBe(200);

    const rest = await api.call('PATCH', '/v1/strategies/S-01', { body: { basePct: 12, confidenceThreshold: 0.8 } });
    expect(rest.statusCode).toBe(200);

    const row = (await pool.query('select * from strategies where id = $1', ['S-01'])).rows[0];
    expect(row.leverage).toBe(10);
    expect(row.margin_mode).toBe('isolated');
    expect(Number(row.base_pct)).toBe(12);
    expect(Number(row.confidence_threshold)).toBe(0.8);
  });

  it('9. enable needs a fresh TOTP; B10.2 allows one active strategy per pair', async () => {
    const noCode = await api.call('POST', '/v1/strategies/S-02/enable');
    expect(noCode.statusCode).toBe(403);

    const enabled = await api.call('POST', '/v1/strategies/S-02/enable', { code: api.freshCode() });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json()).toEqual({ id: 'S-02', status: 'enabled' });

    const pairChange = await api.call('PATCH', '/v1/strategies/S-02', { body: { pair: 'BTCUSDT' } });
    expect(pairChange.statusCode).toBe(409);
    expect(pairChange.json()).toMatchObject({ code: 'disable_first' });

    const s3 = await api.call('POST', '/v1/strategies/S-03/enable', { code: api.freshCode() });
    expect(s3.statusCode).toBe(200);
    expect(s3.json()).toEqual({ id: 'S-03', status: 'enabled' });

    const s4 = await api.call('POST', '/v1/strategies/S-04/enable', { code: api.freshCode() });
    expect(s4.statusCode).toBe(409);
    expect(s4.json().message).toContain('S-03');

    const disabled = await api.call('POST', '/v1/strategies/S-02/disable');
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toEqual({ id: 'S-02', status: 'disabled' });

    const samePair = await api.call('PATCH', '/v1/strategies/S-02', { body: { pair: 'ETHUSDT' } });
    expect(samePair.statusCode).toBe(200);

    const s3Off = await api.call('POST', '/v1/strategies/S-03/disable');
    expect(s3Off.statusCode).toBe(200);
    expect(s3Off.json()).toEqual({ id: 'S-03', status: 'disabled' });
  });

  it('10. close waits for open positions and live orders, then 404 afterwards', async () => {
    const blocked = await api.call('POST', '/v1/strategies/S-01/close');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'position_open' });

    await insertLiveOrder('S-04');
    const ordersOpen = await api.call('POST', '/v1/strategies/S-04/close');
    expect(ordersOpen.statusCode).toBe(409);
    expect(ordersOpen.json()).toMatchObject({ code: 'orders_open' });

    await pool.query(`update orders set status = 'FILLED' where client_order_id = 'S-04-1-entry'`);
    const closed = await api.call('POST', '/v1/strategies/S-04/close');
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toEqual({ id: 'S-04', status: 'closed' });
    expect((await pool.query(`select status from strategies where id = 'S-04'`)).rows[0].status).toBe('closed');
    expect((await pool.query(`select count(*)::int as n from audit_log where action = 'strategy_close' and target = 'S-04'`)).rows[0].n).toBe(1);

    expect((await api.call('POST', '/v1/strategies/S-04/close')).statusCode).toBe(404);
    expect((await api.call('PATCH', '/v1/strategies/S-04', { body: { basePct: 12 } })).statusCode).toBe(404);
    expect((await api.call('POST', '/v1/strategies/S-04/enable', { code: api.freshCode() })).statusCode).toBe(404);
  });

  it('11. B10.8: the list shows price, position, lock and 30-day PnL; closed last; stale on outage', async () => {
    api.exchange.snapshotValue = {
      spotEquity: '1000',
      futuresEquity: '2000',
      tickers: {
        'futures:BTCUSDT': { price: '60000', changePct: '1.5' },
        'spot:ETHUSDT': { price: '3100', changePct: '-0.5' },
      },
      futuresPositions: [
        { pair: 'BTCUSDT', amount: '0.01', entryPrice: '59000', markPrice: '60010', unrealizedPnl: '10.1', liquidationPrice: '48000' },
      ],
    };

    const res = await api.call('GET', '/v1/strategies');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stale).toBe(false);
    expect(body.exchangeError).toBeNull();
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(['S-01', 'S-02', 'S-03', 'S-05', 'S-06', 'S-07', 'S-04']);

    const s1 = body.items.find((i: { id: string }) => i.id === 'S-01');
    expect(s1.price).toBe('60000');
    expect(s1.change24hPct).toBe('1.5');
    expect(s1.locked).toBe(true);
    expect(s1.leverageInUse).toBe(5);
    expect(s1.leverageCeiling).toBe(10);
    expect(s1.position).toMatchObject({ qty: '0.01', entryPrice: '59000', unrealizedPnl: '10.1' });
    expect(s1.pnl30d.total).toBe('0');
    expect(s1.pnl30d.daily).toHaveLength(30);
    expect(s1.pnl30d.daily[0].day).toBe('2029-12-03');
    expect(s1.pnl30d.daily[29].day).toBe('2030-01-01');

    const s2 = body.items.find((i: { id: string }) => i.id === 'S-02');
    expect(s2.price).toBe('3100');
    expect(s2.locked).toBe(false);
    expect(s2.position).toBeNull();
    expect(s2.marginMode).toBeNull();

    api.exchange.failWith = new ExchangeReadError('unreachable', 'x');
    try {
      const stale = await api.call('GET', '/v1/strategies');
      expect(stale.statusCode).toBe(200);
      const s = stale.json();
      expect(s.stale).toBe(true);
      expect(s.exchangeError).toBe('unreachable');
      expect(s.items.find((i: { id: string }) => i.id === 'S-01').price).toBe('60000');
    } finally {
      api.exchange.failWith = null;
    }
  });

  it('12. B10.1: sizing preview from current equity, per mode and market', async () => {
    api.exchange.snapshotValue = {
      spotEquity: '1000',
      futuresEquity: '2000',
      tickers: {
        'futures:BTCUSDT': { price: '60000', changePct: '1.5' },
        'spot:ETHUSDT': { price: '3100', changePct: '-0.5' },
      },
      futuresPositions: [
        { pair: 'BTCUSDT', amount: '0.01', entryPrice: '59000', markPrice: '60010', unrealizedPnl: '10.1', liquidationPrice: '48000' },
      ],
    };

    const b = await api.call('GET', '/v1/strategies/sizing-preview?market=futures&sizingMode=B&basePct=10&leverage=5');
    expect(b.statusCode).toBe(200);
    const bBody = b.json();
    expect(bBody.equity).toBe('2000');
    expect(bBody.rows).toEqual([
      { factors: 0, sizePct: '10', notional: '200', margin: '40' },
      { factors: 2, sizePct: '50', notional: '1000', margin: '200' },
      { factors: 3, sizePct: '70', notional: '1400', margin: '280' },
    ]);

    const a = (await api.call('GET', '/v1/strategies/sizing-preview?market=futures&sizingMode=A&basePct=10&leverage=5')).json();
    expect(a.rows.map((r: { notional: string; margin: string }) => [r.notional, r.margin])).toEqual([
      ['1000', '200'],
      ['5000', '1000'],
      ['7000', '1400'],
    ]);

    const c = (await api.call('GET', '/v1/strategies/sizing-preview?market=futures&sizingMode=C&basePct=10&leverage=5')).json();
    expect(c.rows.map((r: { factors: number; sizePct: string; notional: string | null; margin: string | null }) => [r.factors, r.sizePct, r.notional, r.margin])).toEqual([
      [0, '10', null, null],
      [2, '50', null, null],
      [3, '70', null, null],
    ]);

    const spot = (await api.call('GET', '/v1/strategies/sizing-preview?market=spot&basePct=10')).json();
    expect(spot.equity).toBe('1000');
    expect(spot.rows.map((r: { notional: string; margin: string }) => [r.notional, r.margin])).toEqual([
      ['100', '100'],
      ['500', '500'],
      ['700', '700'],
    ]);

    expect((await api.call('GET', '/v1/strategies/sizing-preview?market=futures&basePct=25')).statusCode).toBe(400);
    expect((await api.call('GET', '/v1/strategies/sizing-preview?market=futures&basePct=25')).json()).toMatchObject({ code: 'bad_basePct' });
    expect((await api.call('GET', '/v1/strategies/sizing-preview?market=margin')).statusCode).toBe(400);
    expect((await api.call('GET', '/v1/strategies/sizing-preview?market=margin')).json()).toMatchObject({ code: 'bad_market' });

    api.exchange.failWith = new ExchangeReadError('unreachable', 'x');
    try {
      const down = await api.call('GET', '/v1/strategies/sizing-preview?market=futures&sizingMode=B&basePct=10&leverage=5');
      expect(down.statusCode).toBe(200);
      const d = down.json();
      expect(d.stale).toBe(true);
      expect(d.exchangeError).toBe('unreachable');
      // B16.9: the last good equity is kept (shown dimmed), not blanked.
      expect(d.equity).toBe('2000');
      expect(d.rows[0].notional).toBe('200');
    } finally {
      api.exchange.failWith = null;
    }
  });

  it('13. no secret material in list or preview responses', async () => {
    const listJson = (await api.call('GET', '/v1/strategies')).json();
    const previewJson = (await api.call('GET', '/v1/strategies/sizing-preview?market=futures&sizingMode=B&basePct=10&leverage=5')).json();
    for (const json of [JSON.stringify(listJson), JSON.stringify(previewJson)]) {
      for (const secret of ['apiKey', 'apiSecret', 'secret']) {
        expect(json).not.toContain(secret);
      }
    }
  });
});
