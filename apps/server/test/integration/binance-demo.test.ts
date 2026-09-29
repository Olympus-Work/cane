/**
 * Plan S05 proof on Binance Demo Trading (BINANCE_ENV=testnet endpoints).
 * Places small real orders on the Demo account. Keys come from the
 * git-ignored apps/server/.env and are never printed. Not part of `pnpm test`
 * or CI: run with `pnpm --filter @cane/server test:integration`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { Decimal } from 'decimal.js';
import { clientOrderId, roundDownToStep, roundToTick, type OrderAction, type SymbolFilters } from '@cane/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENDPOINTS } from '../../src/binance/endpoints.js';
import { BinanceRestClient, type BinanceCredentials, type HttpFn } from '../../src/binance/rest.client.js';
import { BinanceTrading, type OrderRef } from '../../src/binance/trading.js';
import type { UserDataEvent } from '../../src/binance/user-data-events.js';
import { UserDataStream } from '../../src/binance/user-data.stream.js';

const ENV_FILE = fileURLToPath(new URL('../../.env', import.meta.url));
const env = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {};
const spotCreds = credsFrom(env.BINANCE_SPOT_TESTNET_KEY, env.BINANCE_SPOT_TESTNET_SECRET);
const futuresCreds = credsFrom(env.BINANCE_FUTURES_TESTNET_KEY, env.BINANCE_FUTURES_TESTNET_SECRET);

function credsFrom(apiKey: string | undefined, apiSecret: string | undefined): BinanceCredentials | null {
  return apiKey && apiSecret ? { apiKey, apiSecret } : null;
}

const http: HttpFn = (url, init) => fetch(url, init);
const SYMBOL = 'BTCUSDT';
const STRATEGY = 'S-99';
// A fresh "candle time" per run so client IDs never collide with earlier runs.
let candle = Date.now();
const id = (action: OrderAction) => clientOrderId(STRATEGY, candle, action);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(what: string, fn: () => T | undefined, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
  }
}

/** Smallest quantity with notional ≥ target at `price`, on the step. */
function qtyFor(filters: SymbolFilters, price: Decimal, notional: Decimal): Decimal {
  const q = notional.div(price).div(filters.stepSize).ceil().times(filters.stepSize);
  return Decimal.max(q, filters.minQty);
}

describe.skipIf(!futuresCreds)('USDⓈ-M on Demo: entry → stop → trail → exit (S05)', () => {
  const rest = new BinanceRestClient(ENDPOINTS.testnet, () => futuresCreds!, http);
  const trading = new BinanceTrading(rest, true);
  const events: UserDataEvent[] = [];
  const stream = new UserDataStream('futures', ENDPOINTS.testnet, rest, () => futuresCreds!, {
    onEvent: (e) => events.push(e),
    onConnected: () => undefined,
    onError: () => undefined,
  });
  const open: OrderRef[] = [];
  let filters: SymbolFilters;
  let qty: Decimal;

  beforeAll(async () => {
    await stream.start();
    filters = (await trading.symbolInfo('futures', SYMBOL)).filters;
    const mark = await markPrice(rest);
    qty = qtyFor(filters, mark, filters.minNotional.times(1.2));
    await trading.ensureFuturesSetup(SYMBOL, 'isolated', 5);
  }, 60_000);

  afterAll(async () => {
    for (const ref of open) await trading.cancel(ref).catch(() => undefined);
    stream.stop();
  }, 60_000);

  it('sets and verifies isolated margin and leverage (B9.1)', async () => {
    const cfg = (await rest.request('futures', 'GET', '/fapi/v1/symbolConfig', { symbol: SYMBOL }, 'signed', 'safe')) as {
      marginType: string;
      leverage: number;
    }[];
    expect(cfg[0]).toMatchObject({ marginType: 'ISOLATED', leverage: 5 });
  });

  it('runs a long through entry, stop, trail move and exit', async () => {
    const entry = await trading.placeMarket({ market: 'futures', symbol: SYMBOL, side: 'BUY', quantity: qty, clientId: id('entry') });
    expect(entry.status).toBe('FILLED');
    expect(entry.executedQty.eq(qty)).toBe(true);

    // AC5 / E1: the same signal again yields the same order, not a second one.
    const again = await trading.placeMarket({ market: 'futures', symbol: SYMBOL, side: 'BUY', quantity: qty, clientId: id('entry') });
    expect(again.exchangeId).toBe(entry.exchangeId);
    expect((await trading.futuresPosition(SYMBOL)).amount.eq(qty)).toBe(true);

    const mark = await markPrice(rest);
    const stop1 = await trading.placeStop({
      market: 'futures',
      symbol: SYMBOL,
      side: 'SELL',
      quantity: entry.executedQty,
      stopPrice: roundToTick(mark.times(0.8), filters.tickSize, 'down'),
      clientId: id('stop'),
    });
    open.push(stop1.ref);
    expect(stop1.status).toBe('NEW');

    // B5.4 futures trail move: place the new stop (next candle's ID), then cancel the old one.
    const stop1Ref = stop1.ref;
    candle += 1;
    const stop2 = await trading.placeStop({
      market: 'futures',
      symbol: SYMBOL,
      side: 'SELL',
      quantity: entry.executedQty,
      stopPrice: roundToTick(mark.times(0.85), filters.tickSize, 'down'),
      clientId: id('stop'),
    });
    open.push(stop2.ref);
    expect(await trading.cancel(stop1Ref)).toBe('canceled');
    await waitFor('ALGO_UPDATE CANCELED for the old stop', () =>
      events.find((e) => e.kind === 'algo' && e.clientId === stop1Ref.clientId && e.status === 'CANCELED'),
    );

    // B7.1 exit, then B7.3 cancel the remaining stop (Binance does not cancel it).
    const exit = await trading.closeFuturesPosition(SYMBOL, id('exit'));
    expect(exit.kind).toBe('closed');
    expect((await trading.futuresPosition(SYMBOL)).amount.isZero()).toBe(true);
    expect(await trading.cancel(stop2.ref)).toBe('canceled');
    await waitFor('ORDER_TRADE_UPDATE FILLED for the exit', () =>
      events.find((e) => e.kind === 'order' && e.clientId === id('exit') && e.status === 'FILLED'),
    );
  }, 120_000);

  it('sends no exit when the position is already closed (E7)', async () => {
    candle += 1;
    const entry = await trading.placeMarket({ market: 'futures', symbol: SYMBOL, side: 'SELL', quantity: qty, clientId: id('entry') });
    expect(entry.status).toBe('FILLED');
    // Stand-in for "the stop filled between candle close and exit": close it with another order.
    await trading.placeMarket({ market: 'futures', symbol: SYMBOL, side: 'BUY', quantity: qty, clientId: id('bail'), reduceOnly: true });

    expect(await trading.closeFuturesPosition(SYMBOL, id('exit'))).toEqual({ kind: 'already_closed' });
    expect(await trading.query({ market: 'futures', kind: 'order', symbol: SYMBOL, clientId: id('exit') })).toBeNull();
  }, 120_000);
});

describe.skipIf(!spotCreds)('Spot on Demo: entry → stop → trail → exit, OCO (S05)', () => {
  const rest = new BinanceRestClient(ENDPOINTS.testnet, () => spotCreds!, http);
  const trading = new BinanceTrading(rest, true);
  const events: UserDataEvent[] = [];
  const stream = new UserDataStream('spot', ENDPOINTS.testnet, rest, () => spotCreds!, {
    onEvent: (e) => events.push(e),
    onConnected: () => undefined,
    onError: () => undefined,
  });
  const open: OrderRef[] = [];
  let filters: SymbolFilters;
  let qty: Decimal;

  beforeAll(async () => {
    await stream.start();
    candle += 100;
    filters = (await trading.symbolInfo('spot', SYMBOL)).filters;
    qty = qtyFor(filters, await lastPrice(rest), filters.minNotional.times(3));
  }, 60_000);

  afterAll(async () => {
    for (const ref of open) await trading.cancel(ref).catch(() => undefined);
    stream.stop();
  }, 60_000);

  async function buy(): Promise<Decimal> {
    const entry = await trading.placeMarket({ market: 'spot', symbol: SYMBOL, side: 'BUY', quantity: qty, clientId: id('entry') });
    expect(entry.status).toBe('FILLED');
    const received = await trading.spotReceivedQuantity(entry, 'BTC');
    expect(received.lte(entry.executedQty)).toBe(true);
    return roundDownToStep(received, filters.stepSize);
  }

  it('runs a long through entry, stop, trail move and exit', async () => {
    const held = await buy();
    const price = await lastPrice(rest);
    const stop1 = await trading.placeStop({
      market: 'spot',
      symbol: SYMBOL,
      side: 'SELL',
      quantity: held,
      stopPrice: roundToTick(price.times(0.9), filters.tickSize, 'down'),
      clientId: id('stop'),
    });
    open.push(stop1.ref);
    expect(stop1.status).toBe('NEW');

    // B5.4 spot trail move: the old stop locks the balance, so cancel first, then place.
    expect(await trading.cancel(stop1.ref)).toBe('canceled');
    candle += 1;
    const stop2 = await trading.placeStop({
      market: 'spot',
      symbol: SYMBOL,
      side: 'SELL',
      quantity: held,
      stopPrice: roundToTick(price.times(0.92), filters.tickSize, 'down'),
      clientId: id('stop'),
    });
    open.push(stop2.ref);
    expect(stop2.status).toBe('NEW');

    const exit = await trading.closeSpotPosition({ symbol: SYMBOL, baseAsset: 'BTC', quantity: held, protective: [stop2.ref], clientId: id('exit') });
    expect(exit.kind).toBe('closed');
    if (exit.kind === 'closed') expect(exit.order.executedQty.eq(held)).toBe(true);
    await waitFor('executionReport FILLED for the exit', () =>
      events.find((e) => e.kind === 'order' && e.clientId === id('exit') && e.status === 'FILLED'),
    );
  }, 120_000);

  it('protects a late entry with an OCO and exits through it', async () => {
    candle += 1;
    const held = await buy();
    const price = await lastPrice(rest);
    const oco = await trading.placeSpotOco({
      symbol: SYMBOL,
      quantity: held,
      stopPrice: roundToTick(price.times(0.95), filters.tickSize, 'down'),
      takeProfitPrice: roundToTick(price.times(1.05), filters.tickSize, 'up'),
      listClientId: id('oco'),
      stopClientId: id('stop'),
      takeProfitClientId: id('tp'),
    });
    open.push(oco.ref);
    expect(oco.status).toBe('EXECUTING');
    await waitFor('listStatus EXECUTING', () => events.find((e) => e.kind === 'list' && e.clientId === id('oco')));

    const exit = await trading.closeSpotPosition({ symbol: SYMBOL, baseAsset: 'BTC', quantity: held, protective: [oco.ref], clientId: id('exit') });
    expect(exit.kind).toBe('closed');
    const list = await trading.query(oco.ref);
    expect(list?.status).toBe('ALL_DONE');
  }, 120_000);
});

async function markPrice(rest: BinanceRestClient): Promise<Decimal> {
  const body = (await rest.request('futures', 'GET', '/fapi/v1/premiumIndex', { symbol: SYMBOL }, 'none', 'safe')) as { markPrice: string };
  return new Decimal(body.markPrice);
}

async function lastPrice(rest: BinanceRestClient): Promise<Decimal> {
  const body = (await rest.request('spot', 'GET', '/api/v3/ticker/price', { symbol: SYMBOL }, 'none', 'safe')) as { price: string };
  return new Decimal(body.price);
}
