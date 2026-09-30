import 'reflect-metadata';
import { Decimal } from 'decimal.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExchangeReadError } from '../src/exchange/exchange-reader.js';
import { PASSWORD, bootApi, type Api } from './support/api.js';
import { DATABASE_URL } from './support/db.js';

const CANDLE = 1_893_456_000_000;

describe.skipIf(!DATABASE_URL)('Dashboard API (S09.5, B16)', () => {
  let api: Api;
  /** Every response body from tests 1-8, checked for leaks in test 9. */
  const bodies: string[] = [];

  const q = (text: string, params?: unknown[]) => api.pool.query(text, params);
  /** Every request goes through here so its body is collected for the leak check. */
  const req = async (method: 'GET' | 'POST' | 'PATCH', url: string, opts?: Parameters<Api['call']>[2]) => {
    const res = await api.call(method, url, opts);
    bodies.push(res.payload);
    return res;
  };

  beforeAll(async () => {
    api = await bootApi(Date.parse('2030-01-01T12:00:00Z'));
    await q(
      `insert into strategies (id, pair, market, status, leverage, margin_mode) values
        ('S-01','BTCUSDT','futures','disabled',5,'isolated'),
        ('S-02','ETHUSDT','spot','disabled',null,null)`,
    );

    /** A closed trade with its own closed position row (trades.position_id is unique). */
    const addTrade = async (t: { strategyId: string; net: string; closedAt: string; exitReason?: string }): Promise<number> => {
      const spot = t.strategyId === 'S-02';
      const market = spot ? 'spot' : 'futures';
      const pair = spot ? 'ETHUSDT' : 'BTCUSDT';
      const lev = spot ? null : 5;
      const openedAt = new Date(Date.parse(t.closedAt) - 3_600_000).toISOString();
      const pos = await q(
        `insert into positions (strategy_id, market, pair, side, status, entry_kind, signal_timeframe, signal_candle_open_time, qty, entry_price, stop_price, leverage, size_pct, opened_at, closed_at)
         values ($1,$2,$3,'long','closed','primary','1d',$4,'0.01','59000','58000',$5,'10',$6,$7) returning id`,
        [t.strategyId, market, pair, CANDLE, lev, openedAt, t.closedAt],
      );
      const gross = new Decimal(t.net).plus(1).toFixed();
      const tr = await q(
        `insert into trades (position_id, strategy_id, market, pair, side, entry_kind, signal_timeframe, qty, entry_price, exit_price, exit_reason, sizing_mode, size_pct, leverage_configured, leverage_used, gross_pnl, fees, funding, net_pnl, opened_at, closed_at)
         values ($1,$2,$3,$4,'long','primary','1d','0.01','59000','60000',$5,'B','10',$6,$7,$8,'1','0',$9,$10,$11) returning id`,
        [pos.rows[0].id, t.strategyId, market, pair, t.exitReason ?? 'first_green', lev, lev, gross, t.net, openedAt, t.closedAt],
      );
      return tr.rows[0].id as number;
    };

    // Inserted in order so the trade ids are 1..7.
    await addTrade({ strategyId: 'S-01', net: '10.5', closedAt: '2029-12-31T16:59:59Z', exitReason: 'stop' }); // T1
    await addTrade({ strategyId: 'S-01', net: '-4.25', closedAt: '2029-12-31T17:00:00Z' }); // T2
    await addTrade({ strategyId: 'S-01', net: '0', closedAt: '2030-01-01T05:00:00Z', exitReason: 'kill_switch' }); // T3
    await addTrade({ strategyId: 'S-02', net: '3.75', closedAt: '2030-01-01T08:00:00Z' }); // T4
    await addTrade({ strategyId: 'S-01', net: '1', closedAt: '2029-12-01T00:00:00Z' }); // T5
    await addTrade({ strategyId: 'S-01', net: '2', closedAt: '2030-01-01T03:00:00Z' }); // T6
    await addTrade({ strategyId: 'S-01', net: '2', closedAt: '2030-01-01T04:00:00Z' }); // T7

    await q(
      `insert into positions (strategy_id, market, pair, side, status, entry_kind, signal_timeframe, signal_candle_open_time, qty, entry_price, stop_price, leverage, size_pct, opened_at)
       values ('S-01','futures','BTCUSDT','long','open','primary','1d',$1,'0.01','59000','58000',5,'10',now())`,
      [CANDLE],
    );
    await q(
      `insert into positions (strategy_id, market, pair, side, status, entry_kind, signal_timeframe, signal_candle_open_time, qty, entry_price, stop_price, leverage, size_pct, opened_at)
       values ('S-02','spot','ETHUSDT','long','open','primary','1d',$1,'2','3000','2800',null,'10',now())`,
      [CANDLE],
    );

    api.exchange.snapshotValue = {
      spotEquity: '1234.5',
      futuresEquity: '2345.25',
      tickers: { 'futures:BTCUSDT': { price: '60000', changePct: '1.5' }, 'spot:ETHUSDT': { price: '3100', changePct: '-0.5' } },
      futuresPositions: [{ pair: 'BTCUSDT', amount: '0.01', entryPrice: '59000', markPrice: '60010', unrealizedPnl: '10.1', liquidationPrice: '48000' }],
    };
  });

  afterAll(async () => {
    await api.close();
  });

  it('1. dashboard overview: cards, open positions, no alerts', async () => {
    const res = await req('GET', '/v1/dashboard');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('running');
    expect(body.stale).toBe(false);
    expect(typeof body.lastSyncAt).toBe('string');
    expect(body.cards).toEqual({
      spotEquity: '1234.5',
      futuresEquity: '2345.25',
      realisedToday: '3.5',
      realisedTotal: '15',
      tradeCount: 7,
      openPositions: { spot: 1, futures: 1 },
    });
    expect(body.alerts).toEqual([]);
    expect(body.positions).toHaveLength(2);
    const btc = body.positions.find((p: { strategyId: string }) => p.strategyId === 'S-01');
    const eth = body.positions.find((p: { strategyId: string }) => p.strategyId === 'S-02');
    expect(btc).toMatchObject({
      markPrice: '60010',
      change24hPct: '1.5',
      unrealizedPnl: '10.1',
      unrealizedPnlPct: '1.71',
      liquidationPrice: '48000',
      stopPrice: '58000',
      leverage: 5,
    });
    expect(eth).toMatchObject({
      markPrice: '3100',
      change24hPct: '-0.5',
      unrealizedPnl: '200',
      unrealizedPnlPct: '3.33',
      liquidationPrice: null,
    });
  });

  it('2. 30-day PnL: Bangkok day boundary at 00:00 ICT', async () => {
    const res = await req('GET', '/v1/strategies');
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    const s1 = items.find((s: { id: string }) => s.id === 'S-01');
    const s2 = items.find((s: { id: string }) => s.id === 'S-02');
    expect(s1.pnl30d.total).toBe('10.25');
    expect(s1.pnl30d.daily).toHaveLength(30);
    expect(s1.pnl30d.daily[0].day).toBe('2029-12-03');
    expect(s1.pnl30d.daily[29].day).toBe('2030-01-01');
    const s1ByDay = new Map(s1.pnl30d.daily.map((d: { day: string; pnl: string }) => [d.day, d.pnl]));
    expect(s1ByDay.get('2029-12-31')).toBe('10.5');
    expect(s1ByDay.get('2030-01-01')).toBe('-0.25');
    expect(s1ByDay.has('2029-12-01')).toBe(false);
    expect(s2.pnl30d.total).toBe('3.75');
    const s2ByDay = new Map(s2.pnl30d.daily.map((d: { day: string; pnl: string }) => [d.day, d.pnl]));
    expect(s2ByDay.get('2030-01-01')).toBe('3.75');
  });

  it('3. heatmap: one row per Bangkok day with a trade', async () => {
    const res = await req('GET', '/v1/dashboard/heatmap');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.days).toBe(365);
    expect(body.items).toEqual([
      { day: '2029-12-01', trades: 1, wins: 1, losses: 0, pnl: '1', level: 1 },
      { day: '2029-12-31', trades: 1, wins: 1, losses: 0, pnl: '10.5', level: 1 },
      { day: '2030-01-01', trades: 5, wins: 3, losses: 1, pnl: '3.5', level: 4 },
    ]);
    const ten = await req('GET', '/v1/dashboard/heatmap?days=10');
    expect(ten.statusCode).toBe(200);
    expect(ten.json().items.map((i: { day: string }) => i.day)).toEqual(['2029-12-31', '2030-01-01']);
    for (const days of ['0', '401', 'abc']) {
      const bad = await req('GET', `/v1/dashboard/heatmap?days=${days}`);
      expect(bad.statusCode).toBe(400);
      expect(bad.json().code).toBe('bad_days');
    }
  });

  it('4. trade list: newest first, id cursor paging, bad params', async () => {
    const res = await req('GET', '/v1/trades');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.map((t: { id: number }) => t.id)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(body.nextBefore).toBeNull();
    for (const t of body.items) {
      expect(t).toMatchObject({
        strategyId: expect.any(String),
        pair: expect.any(String),
        market: expect.any(String),
        side: 'long',
        entryPrice: '59000',
        exitPrice: '60000',
        qty: '0.01',
        netPnl: expect.any(String),
        exitReason: expect.any(String),
        openedAt: expect.any(String),
        closedAt: expect.any(String),
      });
      expect(new Date(t.openedAt).toISOString()).toBe(t.openedAt);
      expect(new Date(t.closedAt).toISOString()).toBe(t.closedAt);
    }
    const p1 = await req('GET', '/v1/trades?limit=3');
    expect(p1.json().items.map((t: { id: number }) => t.id)).toEqual([7, 6, 5]);
    expect(p1.json().nextBefore).toBe(5);
    const p2 = await req('GET', '/v1/trades?limit=3&before=5');
    expect(p2.json().items.map((t: { id: number }) => t.id)).toEqual([4, 3, 2]);
    expect(p2.json().nextBefore).toBe(2);
    const p3 = await req('GET', '/v1/trades?limit=3&before=2');
    expect(p3.json().items.map((t: { id: number }) => t.id)).toEqual([1]);
    expect(p3.json().nextBefore).toBeNull();
    for (const [qs, code] of [
      ['limit=0', 'bad_limit'],
      ['limit=101', 'bad_limit'],
      ['before=0', 'bad_before'],
      ['before=x', 'bad_before'],
    ] as const) {
      const bad = await req('GET', `/v1/trades?${qs}`);
      expect(bad.statusCode).toBe(400);
      expect(bad.json().code).toBe(code);
    }
  });

  it('5. trade detail: Jev factors, threshold, leverage, pnl', async () => {
    const response = {
      model: 'jev-1.13.0',
      answers: {
        channel_breakout: { type: 'noul', noul: 0.9 },
        capitulation: { type: 'noul', noul: 0.6 },
        higher_low: { type: 'noul', noul: 0.4 },
      },
    };
    const jev = await q(
      `insert into jev_calls (strategy_id, side, timeframe, model, request, response, fallback)
       values ('S-01','long','1d','jev-1.13.0','{}',$1::jsonb,false) returning id`,
      [JSON.stringify(response)],
    );
    await q(`update trades set jev_call_id = $1 where id = 1`, [jev.rows[0].id]);

    const res = await req('GET', '/v1/trades/1');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.factors).toEqual([
      { name: 'channel_breakout', confidence: 0.9, present: true, counted: true },
      { name: 'capitulation', confidence: 0.6, present: true, counted: false },
      { name: 'higher_low', confidence: 0.4, present: false, counted: false },
    ]);
    expect(body.threshold).toBe('0.7');
    expect(body.jevFallback).toBe(false);
    expect(body.sizingMode).toBe('B');
    expect(body.sizePct).toBe('10');
    expect(body.leverage).toEqual({ configured: 5, used: 5, lowered: false });
    expect(body.pnl).toEqual({ gross: '11.5', fees: '1', funding: '0', net: '10.5' });
    expect(body.exitReason).toBe('stop');
    expect(body.signalTimeframe).toBe('1d');

    const t2 = await req('GET', '/v1/trades/2');
    expect(t2.statusCode).toBe(200);
    expect(t2.json().factors).toBeNull();

    await q(`update trades set leverage_used = 3 where id = 3`);
    const t3 = await req('GET', '/v1/trades/3');
    expect(t3.json().leverage).toEqual({ configured: 5, used: 3, lowered: true });

    expect((await req('GET', '/v1/trades/999')).statusCode).toBe(404);
    expect((await req('GET', '/v1/trades/abc')).statusCode).toBe(404);
  });

  it('6. alerts: needs_attention and jev fallback (24 h window)', async () => {
    // `now()` in the DB is the REAL clock; the 24 h window is judged against the fake now, so stamp it explicitly.
    const fb = await q(
      `insert into jev_calls (strategy_id, side, timeframe, model, request, response, error, fallback, created_at)
       values ('S-01','long','1d','jev-1.13.0','{}',null,'timeout',true,$1) returning id`,
      [new Date().toISOString()],
    );
    const fbId = fb.rows[0].id;
    await q(`update strategies set status = 'needs_attention', attention_reason = 'Order rejected: insufficient margin' where id = 'S-01'`);

    const res = await req('GET', '/v1/dashboard');
    expect(res.statusCode).toBe(200);
    const alerts = res.json().alerts;
    expect(alerts).toContainEqual({ kind: 'needs_attention', strategyId: 'S-01', pair: 'BTCUSDT', reason: 'Order rejected: insufficient margin', link: 'strategies' });
    expect(alerts).toContainEqual({ kind: 'jev_fallback', count: 1, link: 'trades' });

    // Backdate the fallback 25 h before the fake now: outside the 24 h window.
    await q(`update jev_calls set created_at = $1 where id = $2`, [new Date(Date.now() - 25 * 3_600_000).toISOString(), fbId]);
    const again = await req('GET', '/v1/dashboard');
    expect(again.json().alerts).not.toContainEqual(expect.objectContaining({ kind: 'jev_fallback' }));
  });

  it('7. exchange down: last good snapshot kept, error alerts', async () => {
    api.exchange.failWith = new ExchangeReadError('unreachable', 'x');
    const down = await req('GET', '/v1/dashboard');
    expect(down.statusCode).toBe(200);
    const body = down.json();
    expect(body.status).toBe('exchange_unreachable');
    expect(body.stale).toBe(true);
    expect(body.cards.spotEquity).toBe('1234.5');
    expect(body.alerts).toContainEqual({ kind: 'exchange_unreachable', link: 'settings' });

    api.exchange.failWith = new ExchangeReadError('key_rejected', 'x');
    const key = await req('GET', '/v1/dashboard');
    expect(key.statusCode).toBe(200);
    expect(key.json().status).toBe('running');
    expect(key.json().alerts).toContainEqual({ kind: 'key_error', link: 'settings' });

    api.exchange.failWith = null;
    const ok = await req('GET', '/v1/dashboard');
    expect(ok.json().stale).toBe(false);
  });

  it('8. audit log: newest first, id cursor paging, bad params', async () => {
    const res = await req('GET', '/v1/audit-log');
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(Array.isArray(items)).toBe(true);
    for (let i = 0; i < items.length; i++) {
      for (const k of ['id', 'at', 'actor', 'action', 'target', 'before', 'after', 'ip']) expect(items[i]).toHaveProperty(k);
      if (i > 0) expect(items[i].id).toBeLessThan(items[i - 1].id);
    }

    for (const action of ['test_a', 'test_b', 'test_c']) {
      await q(`insert into audit_log (actor, action) values ('owner', $1)`, [action]);
    }
    const p1 = await req('GET', '/v1/audit-log?limit=2');
    expect(p1.json().items.map((r: { action: string }) => r.action)).toEqual(['test_c', 'test_b']);
    const cursor = p1.json().nextBefore;
    expect(p1.json().items[1].id).toBe(cursor);
    const p2 = await req('GET', `/v1/audit-log?limit=2&before=${cursor}`);
    expect(p2.json().items[0].action).toBe('test_a');

    const badLimit = await req('GET', '/v1/audit-log?limit=0');
    expect(badLimit.statusCode).toBe(400);
    expect(badLimit.json().code).toBe('bad_limit');
    const badBefore = await req('GET', '/v1/audit-log?before=x');
    expect(badBefore.statusCode).toBe(400);
    expect(badBefore.json().code).toBe('bad_before');
  });

  it('9. no secrets in any response body', () => {
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) {
      expect(b).not.toContain('apiKey');
      expect(b).not.toContain('apiSecret');
      expect(b).not.toContain(PASSWORD);
    }
  });
});
