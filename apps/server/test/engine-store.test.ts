import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { EngineStore, type NewTrade } from '../src/engine/store.js';
import { DATABASE_URL, freshDb } from './support/db.js';

describe.skipIf(!DATABASE_URL)('EngineStore', () => {
  let pool: pg.Pool;
  let store: EngineStore;

  beforeEach(async () => {
    await pool?.end();
    pool = await freshDb();
    store = new EngineStore(drizzle(pool));
  });

  afterAll(async () => {
    await pool.end();
  });

  /** Insert a strategy row. Futures rows carry leverage + margin mode; spot rows omit them. */
  async function strategy(id: string, status: string, market: 'futures' | 'spot' = 'futures', pair = 'BTCUSDT'): Promise<void> {
    if (market === 'futures') {
      await pool.query(
        "insert into strategies(id, pair, market, status, leverage, margin_mode) values ($1, $2, 'futures', $3, 5, 'isolated')",
        [id, pair, status],
      );
    } else {
      await pool.query("insert into strategies(id, pair, market, status) values ($1, $2, 'spot', $3)", [id, pair, status]);
    }
  }

  /** Insert a position for a strategy; closed_at is set only for closed positions. */
  async function position(strategyId: string, status: 'open' | 'closed' = 'open', pair = 'BTCUSDT'): Promise<number> {
    const { rows } = await pool.query<{ id: number }>(
      `insert into positions(strategy_id, market, pair, side, status, entry_kind, signal_timeframe, signal_candle_open_time,
                              qty, entry_price, stop_price, size_pct, opened_at, closed_at)
       values ($1, 'futures', $2, 'long', $3, 'primary', '1d', 1727740800000, '0.002', '84000', '80000', '10', now(), $4)
       returning id`,
      [strategyId, pair, status, status === 'closed' ? new Date() : null],
    );
    return Number(rows[0]!.id); // pg returns bigints as strings
  }

  /** Insert an order row through the store. */
  async function order(
    strategyId: string,
    clientOrderId: string,
    purpose: 'entry' | 'stop' | 'take_profit' | 'exit' | 'kill_switch' | 'reconcile',
    status: string,
    pair = 'BTCUSDT',
    positionId?: number,
  ): Promise<void> {
    await store.insertOrder({
      strategyId,
      clientOrderId,
      market: 'futures',
      pair,
      side: 'BUY',
      type: 'MARKET',
      purpose,
      status,
      qty: '0.002',
      positionId,
    });
  }

  it('managedStrategies returns enabled, needs_attention and disabled-with-open-position strategies', async () => {
    await strategy('S-01', 'enabled', 'futures', 'BTCUSDT');
    await strategy('S-02', 'needs_attention', 'futures', 'ETHUSDT');
    await strategy('S-03', 'disabled', 'futures', 'SOLUSDT');
    await strategy('S-04', 'disabled', 'futures', 'XRPUSDT');
    await strategy('S-05', 'closed', 'futures', 'BNBUSDT');
    await position('S-04', 'open', 'XRPUSDT');
    await position('S-05', 'closed', 'BNBUSDT');

    const rows = await store.managedStrategies();
    expect(rows.map((r) => r.id)).toEqual(['S-01', 'S-02', 'S-04']);
  });

  it('claimSignal is idempotent per strategy, timeframe and candle', async () => {
    await strategy('S-01', 'enabled');

    const first = await store.claimSignal('S-01', '4h', 1000, { a: 1 });
    expect(typeof first).toBe('number');
    expect(await store.claimSignal('S-01', '4h', 1000, { a: 1 })).toBeNull();
    const other = await store.claimSignal('S-01', '1d', 1000, {});
    expect(typeof other).toBe('number');
  });

  it('annotateSignal merges keys into the decision JSON', async () => {
    await strategy('S-01', 'enabled');

    const id = await store.claimSignal('S-01', '4h', 1000, { type: 'enter' });
    expect(id).toBeTypeOf('number');
    await store.annotateSignal(id!, { entry: { k: 1 } });
    expect(await store.signalDecision(id!)).toEqual({ type: 'enter', entry: { k: 1 } });
  });

  it('openPosition returns the open position and null when only a closed one exists', async () => {
    await strategy('S-01', 'enabled');
    await strategy('S-02', 'disabled', 'futures', 'ETHUSDT');
    const openId = await position('S-01', 'open');
    await position('S-02', 'closed', 'ETHUSDT');

    const open = await store.openPosition('S-01');
    expect(open?.id).toBe(openId);
    expect(await store.openPosition('S-02')).toBeNull();
  });

  it('inserts, updates and looks up orders by client order id', async () => {
    await strategy('S-01', 'enabled');

    await order('S-01', 'S-01-1000-entry', 'entry', 'PENDING');
    let row = await store.orderByClientId('S-01-1000-entry');
    expect(row?.status).toBe('PENDING');

    await store.updateOrder('S-01-1000-entry', { status: 'FILLED', exchangeOrderId: '9' });
    row = await store.orderByClientId('S-01-1000-entry');
    expect(row?.status).toBe('FILLED');
    expect(row?.exchangeOrderId).toBe('9');

    expect(await store.orderByClientId('nope')).toBeNull();
  });

  it('pendingEntries returns only PENDING entry orders of the strategy', async () => {
    await strategy('S-01', 'enabled');
    await strategy('S-02', 'needs_attention', 'futures', 'ETHUSDT');

    await order('S-01', 'S-01-1000-entry', 'entry', 'PENDING');
    await order('S-01', 'S-01-1100-entry', 'entry', 'FILLED');
    await order('S-01', 'S-01-1000-stop', 'stop', 'PENDING');
    await order('S-02', 'S-02-1000-entry', 'entry', 'PENDING', 'ETHUSDT');

    const rows = await store.pendingEntries('S-01');
    expect(rows.map((r) => r.clientOrderId)).toEqual(['S-01-1000-entry']);
  });

  it('protectiveOrders returns open stop and take-profit orders of the position', async () => {
    await strategy('S-01', 'enabled');
    await strategy('S-02', 'needs_attention', 'futures', 'ETHUSDT');
    const pos1 = await position('S-01', 'open');
    const pos2 = await position('S-02', 'open', 'ETHUSDT');

    await order('S-01', 'p1-stop-new', 'stop', 'NEW', 'BTCUSDT', pos1);
    await order('S-01', 'p1-tp-new', 'take_profit', 'NEW', 'BTCUSDT', pos1);
    await order('S-01', 'p1-stop-pending', 'stop', 'PENDING', 'BTCUSDT', pos1);
    await order('S-01', 'p1-stop-exec', 'stop', 'EXECUTING', 'BTCUSDT', pos1);
    await order('S-01', 'p1-stop-cancel', 'stop', 'CANCELED', 'BTCUSDT', pos1);
    await order('S-01', 'p1-exit-new', 'exit', 'NEW', 'BTCUSDT', pos1);
    await order('S-02', 'p2-stop-new', 'stop', 'NEW', 'ETHUSDT', pos2);

    const rows = await store.protectiveOrders(pos1);
    expect(rows.map((r) => r.clientOrderId).sort()).toEqual(['p1-stop-exec', 'p1-stop-new', 'p1-stop-pending', 'p1-tp-new']);
  });

  it('entryOrder returns the entry order and unbookedExits only PENDING/FILLED exits', async () => {
    await strategy('S-01', 'enabled');
    const pos = await position('S-01', 'open');

    await order('S-01', 'S-01-1000-entry', 'entry', 'FILLED', 'BTCUSDT', pos);
    await order('S-01', 'S-01-1000-exit-pending', 'exit', 'PENDING', 'BTCUSDT', pos);
    await order('S-01', 'S-01-1000-exit-filled', 'exit', 'FILLED', 'BTCUSDT', pos);
    await order('S-01', 'S-01-1000-exit-notsent', 'exit', 'NOT_SENT', 'BTCUSDT', pos);

    const entry = await store.entryOrder(pos);
    expect(entry?.clientOrderId).toBe('S-01-1000-entry');

    const exits = await store.unbookedExits(pos);
    expect(exits.map((r) => r.clientOrderId).sort()).toEqual(['S-01-1000-exit-filled', 'S-01-1000-exit-pending']);
  });

  it('setStrategyStatus records the status and the attention reason', async () => {
    await strategy('S-01', 'enabled');

    await store.setStrategyStatus('S-01', 'needs_attention', 'Missing stop');
    const row = await store.strategy('S-01');
    expect(row?.status).toBe('needs_attention');
    expect(row?.attentionReason).toBe('Missing stop');
  });

  it('audit appends a system row', async () => {
    await strategy('S-01', 'enabled');

    await store.audit('strategy_needs_attention', 'S-01', { reason: 'x' });
    const { rows } = await pool.query<{ actor: string; action: string; target: string }>(
      'select actor, action, target from audit_log',
    );
    expect(rows).toEqual([{ actor: 'system', action: 'strategy_needs_attention', target: 'S-01' }]);
  });

  it('insertJevCall returns an id and insertTrade is unique per position', async () => {
    await strategy('S-01', 'enabled');
    const pos = await position('S-01', 'open');

    const jevId = await store.insertJevCall({
      strategyId: 'S-01',
      side: 'long',
      timeframe: '1d',
      model: 'none',
      request: {},
      fallback: true,
    });
    expect(typeof jevId).toBe('number');

    const trade: NewTrade = {
      positionId: pos,
      strategyId: 'S-01',
      jevCallId: jevId,
      market: 'futures',
      pair: 'BTCUSDT',
      side: 'long',
      entryKind: 'primary',
      signalTimeframe: '1d',
      qty: '0.002',
      entryPrice: '84000',
      exitPrice: '86000',
      exitReason: 'take_profit',
      sizingMode: 'B',
      sizePct: '10',
      grossPnl: '0.004',
      fees: '0.0001',
      netPnl: '0.0039',
      openedAt: new Date('2024-10-01T00:00:00Z'),
      closedAt: new Date('2024-10-02T00:00:00Z'),
    };
    await store.insertTrade(trade);
    // drizzle wraps the pg error in `cause`
    await expect(store.insertTrade(trade)).rejects.toMatchObject({ cause: { code: '23505' } });
  });
});
