/**
 * Plan S06 proof (AC6) on Binance Demo Trading + a throwaway Postgres: an
 * entry killed right after its order was sent is finished by the reconciler
 * after a "restart", every position ends up with an exchange stop, and the
 * trail / exit / closed-on-exchange paths keep the DB in step with Binance.
 * Needs DATABASE_URL and the Demo keys in apps/server/.env. Local only:
 * `pnpm --filter @cane/server test:integration`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { Decimal } from 'decimal.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { roundToTick } from '@cane/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENDPOINTS } from '../../src/binance/endpoints.js';
import { BinanceRestClient, type BinanceCredentials, type HttpFn } from '../../src/binance/rest.client.js';
import { BinanceTrading } from '../../src/binance/trading.js';
import { KeyedMutex } from '../../src/engine/engine.js';
import { Executor, refOf, type EntryIntent } from '../../src/engine/executor.js';
import type { Notifier, NotifyEvent } from '../../src/engine/ports.js';
import { Reconciler } from '../../src/engine/reconciler.js';
import { EngineStore, type StrategyRow } from '../../src/engine/store.js';
import { DATABASE_URL, freshDb } from '../support/db.js';

const ENV_FILE = fileURLToPath(new URL('../../.env', import.meta.url));
const env = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {};
const creds: BinanceCredentials | null =
  env.BINANCE_FUTURES_TESTNET_KEY && env.BINANCE_FUTURES_TESTNET_SECRET
    ? { apiKey: env.BINANCE_FUTURES_TESTNET_KEY, apiSecret: env.BINANCE_FUTURES_TESTNET_SECRET }
    : null;

const http: HttpFn = (url, init) => fetch(url, init);
const H4 = 4 * 3600_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class CrashAfterSend extends Error {}

/** Collects notifications instead of sending them. */
class Recorder implements Notifier {
  events: { event: NotifyEvent; details: Record<string, unknown> }[] = [];
  async notify(event: NotifyEvent, _s: string | null, details: Record<string, unknown>): Promise<void> {
    this.events.push({ event, details });
  }
}

describe.skipIf(!creds || !DATABASE_URL)('engine on Demo + Postgres (S06, AC6)', () => {
  const rest = new BinanceRestClient(ENDPOINTS.testnet, () => creds!, http);
  const trading = new BinanceTrading(rest, true);
  let pool: pg.Pool;
  // Client order IDs are keyed to this. A 4H-aligned key would repeat within one
  // 4H window, and query-before-send (E1) would then find the previous run's orders.
  let key = Date.now();

  /** A new "process": fresh store, executor and reconciler over the same DB and exchange. */
  function boot(t: BinanceTrading = trading) {
    const store = new EngineStore(drizzle(pool));
    const notifier = new Recorder();
    const deps = { store, trading: t, notifier, now: Date.now, sleep };
    const executor = new Executor(deps);
    const reconciler = new Reconciler({ ...deps, executor, mutex: new KeyedMutex() });
    return { store, notifier, executor, reconciler };
  }

  async function strategyRow(id: string): Promise<StrategyRow> {
    return (await boot().store.strategy(id))!;
  }

  async function price(market: 'spot' | 'futures'): Promise<Decimal> {
    const body =
      market === 'futures'
        ? ((await rest.request('futures', 'GET', '/fapi/v1/premiumIndex', { symbol: 'BTCUSDT' }, 'none', 'safe')) as { markPrice: string }).markPrice
        : ((await rest.request('spot', 'GET', '/api/v3/ticker/price', { symbol: 'BTCUSDT' }, 'none', 'safe')) as { price: string }).price;
    return new Decimal(body);
  }

  async function intent(strategyId: string, market: 'spot' | 'futures', withTp: boolean): Promise<EntryIntent> {
    key += H4;
    const px = await price(market);
    const { store } = boot();
    const signalId = (await store.claimSignal(strategyId, '4h', key, { type: 'enter' }))!;
    return {
      key,
      signalId,
      side: 'long',
      kind: withTp ? 'late' : 'primary',
      signalTimeframe: withTp ? '4h' : '1d',
      signalOpenTime: key,
      refPrice: px,
      stop: roundToTick(px.times(0.8), new Decimal('0.1'), 'down'),
      takeProfit: withTp ? px.times(1.05) : null,
      trend1w: 'bullish',
      jev: null,
    };
  }

  /** Client IDs of the position's protective orders that are open on Binance. */
  async function openStops(positionId: number): Promise<string[]> {
    const open = await trading.openClientIds('futures', 'BTCUSDT');
    return (await boot().store.protectiveOrders(positionId)).map((o) => o.clientOrderId).filter((id) => open.has(id));
  }

  beforeAll(async () => {
    pool = await freshDb();
    // Small sizes: base 5% of Demo equity, futures at 2x.
    await pool.query(
      `insert into strategies(id, pair, market, status, leverage, margin_mode, base_pct) values ('S-98','BTCUSDT','futures','enabled',2,'isolated','5')`,
    );
    const pos = await trading.futuresPosition('BTCUSDT');
    if (!pos.amount.isZero()) throw new Error('Demo account has an open BTCUSDT futures position; close it first');
  }, 60_000);

  afterAll(async () => {
    // Leave Demo flat even if a test failed half-way.
    const pos = await trading.futuresPosition('BTCUSDT').catch(() => null);
    if (pos && !pos.amount.isZero()) {
      await trading.placeMarket({ market: 'futures', symbol: 'BTCUSDT', side: pos.amount.gt(0) ? 'SELL' : 'BUY', quantity: pos.amount.abs(), clientId: `S-98-${Date.now()}-kill`, reduceOnly: true });
    }
    const { store } = boot();
    const rows = await pool.query<{ client_order_id: string }>(`select client_order_id from orders where purpose in ('stop','take_profit')`);
    for (const r of rows.rows) {
      const o = await store.orderByClientId(r.client_order_id);
      if (o) await trading.cancel(refOf(o)).catch(() => undefined);
    }
    await pool.end();
  }, 120_000);

  it('AC6: an entry killed after the send is finished by the reconciler, with a stop', async () => {
    // "Process 1" dies right after Binance accepted the entry, before anything else was recorded.
    const crashing = new Proxy(trading, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver) as unknown;
        if (prop !== 'placeMarket' || typeof v !== 'function') return v;
        return async (...args: unknown[]) => {
          await (v as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          throw new CrashAfterSend('killed after send');
        };
      },
    });
    const first = boot(crashing);
    const s = await strategyRow('S-98');
    await expect(first.executor.enter(s, await intent('S-98', 'futures', false))).rejects.toBeInstanceOf(CrashAfterSend);
    expect(await first.store.openPosition('S-98')).toBeNull();
    expect((await first.store.pendingEntries('S-98')).length).toBe(1);
    expect((await trading.futuresPosition('BTCUSDT')).amount.gt(0)).toBe(true);

    // "Process 2" starts: reconcile on start-up (B12.1).
    const second = boot();
    await second.reconciler.reconcileAll();
    const p = await second.store.openPosition('S-98');
    expect(p).not.toBeNull();
    expect((await trading.futuresPosition('BTCUSDT')).amount.eq(p!.qty)).toBe(true);
    expect(await openStops(p!.id)).toHaveLength(1);
    expect((await second.store.pendingEntries('S-98')).length).toBe(0);
    expect(second.notifier.events.map((e) => e.event)).toContain('entry_filled');
  }, 180_000);

  it('B12.2: a stop missing on Binance is re-placed and flagged', async () => {
    const { store, reconciler, notifier } = boot();
    const p = (await store.openPosition('S-98'))!;
    const [stopRow] = (await store.protectiveOrders(p.id)).filter((o) => o.purpose === 'stop');
    await trading.cancel(refOf(stopRow!)); // someone removed the stop on Binance

    await reconciler.reconcileOne('S-98');
    expect(await openStops(p.id)).toHaveLength(1);
    const s = await strategyRow('S-98');
    expect(s.status).toBe('needs_attention');
    expect(s.attentionReason).toBe('Missing stop');
    expect(notifier.events.map((e) => e.event)).toContain('reconcile_mismatch');

    // A second reconcile finds nothing new and does not notify again.
    const again = boot();
    await again.reconciler.reconcileOne('S-98');
    expect(again.notifier.events).toHaveLength(0);
    await pool.query(`update strategies set status = 'enabled', attention_reason = null where id = 'S-98'`);
  }, 180_000);

  it('B5.4: a futures trail move places the new stop, then cancels the old one', async () => {
    const { store, executor } = boot();
    const p = (await store.openPosition('S-98'))!;
    const [oldStop] = await openStops(p.id);
    key += H4;
    await executor.moveStop(await strategyRow('S-98'), p, new Decimal(p.stopPrice).times(1.05), key);
    const now = await openStops(p.id);
    expect(now).toHaveLength(1);
    expect(now[0]).not.toBe(oldStop);
    expect(new Decimal((await store.openPosition('S-98'))!.stopPrice).gt(p.stopPrice)).toBe(true);
  }, 180_000);

  it('B7: an exit closes at market, cancels the stop and books the trade', async () => {
    const { store, executor, notifier } = boot();
    const p = (await store.openPosition('S-98'))!;
    key += H4;
    const pnl = await executor.exit(await strategyRow('S-98'), p, 'first_red', key);
    expect(pnl).not.toBeNull();
    expect((await trading.futuresPosition('BTCUSDT')).amount.isZero()).toBe(true);
    expect(await openStops(p.id)).toHaveLength(0);
    expect(await store.openPosition('S-98')).toBeNull();
    const trade = await pool.query<{ exit_reason: string; net_pnl: string; fees: string }>(`select exit_reason, net_pnl, fees from trades where position_id = $1`, [p.id]);
    expect(trade.rows[0]!.exit_reason).toBe('first_red');
    expect(new Decimal(trade.rows[0]!.fees).gt(0)).toBe(true);
    expect(notifier.events.map((e) => e.event)).toContain('exit_filled');
  }, 180_000);

  it('B12: a position closed on Binance outside the system is booked and flagged', async () => {
    const { executor } = boot();
    const p = await executor.enter(await strategyRow('S-98'), await intent('S-98', 'futures', false));
    expect(p).not.toBeNull();
    await trading.placeMarket({ market: 'futures', symbol: 'BTCUSDT', side: 'SELL', quantity: new Decimal(p!.qty), clientId: `S-98-${Date.now()}-kill`, reduceOnly: true });
    await sleep(1000);

    const { store, reconciler } = boot();
    await reconciler.reconcileOne('S-98');
    expect(await store.openPosition('S-98')).toBeNull();
    const trade = await pool.query<{ exit_reason: string }>(`select exit_reason from trades where position_id = $1`, [p!.id]);
    expect(trade.rows[0]!.exit_reason).toBe('manual');
    expect(await openStops(p!.id)).toHaveLength(0);
    expect((await strategyRow('S-98')).attentionReason).toBe('Position closed outside the system');
    await pool.query(`update strategies set status = 'enabled', attention_reason = null where id = 'S-98'`);
  }, 180_000);

  it('spot late entry: OCO, trail move keeps the take-profit, exit books the trade', async () => {
    await pool.query(`insert into strategies(id, pair, market, status, base_pct) values ('S-97','ETHUSDT','spot','enabled','5')`);
    const { executor, store, reconciler } = boot();
    const s = await strategyRow('S-97');
    key += H4;
    const px = new Decimal(((await rest.request('spot', 'GET', '/api/v3/ticker/price', { symbol: 'ETHUSDT' }, 'none', 'safe')) as { price: string }).price);
    const signalId = (await store.claimSignal('S-97', '4h', key, { type: 'enter' }))!;
    const p = await executor.enter(s, {
      key,
      signalId,
      side: 'long',
      kind: 'late',
      signalTimeframe: '4h',
      signalOpenTime: key,
      refPrice: px,
      stop: px.times(0.95),
      takeProfit: px.times(1.05),
      trend1w: 'bullish',
      jev: null,
    });
    expect(p).not.toBeNull();
    const openOco = async () => {
      const open = await trading.openClientIds('spot', 'ETHUSDT');
      return (await store.protectiveOrders(p!.id)).filter((o) => o.type === 'OCO' && open.has(o.clientOrderId)).map((o) => o.clientOrderId);
    };
    expect(await openOco()).toHaveLength(1);

    await reconciler.reconcileOne('S-97'); // nothing to repair
    expect((await strategyRow('S-97')).status).toBe('enabled');

    key += H4;
    await executor.moveStop(s, p!, px.times(0.96), key);
    const after = await openOco();
    expect(after).toHaveLength(1);
    expect(after[0]).toContain(String(key));

    key += H4;
    const pnl = await executor.exit(s, (await store.openPosition('S-97'))!, 'first_red', key);
    expect(pnl?.qty.eq(p!.qty)).toBe(true);
    expect(await openOco()).toHaveLength(0);
    expect(await store.openPosition('S-97')).toBeNull();
  }, 180_000);

  it('B12.3: a position the system did not open is flagged and left alone', async () => {
    const qty = new Decimal('0.002');
    await trading.placeMarket({ market: 'futures', symbol: 'BTCUSDT', side: 'BUY', quantity: qty, clientId: `S-98-${Date.now()}-kill` });
    const { reconciler, store } = boot();
    await reconciler.reconcileOne('S-98');
    expect((await strategyRow('S-98')).status).toBe('needs_attention');
    expect(await store.openPosition('S-98')).toBeNull();
    expect((await trading.futuresPosition('BTCUSDT')).amount.eq(qty)).toBe(true); // untouched (B11.3)
  }, 180_000);
});
