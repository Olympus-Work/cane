import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { BinanceMarket } from '../src/binance/endpoints.js';
import {
  BinanceError,
  UnknownOutcomeError,
  type Auth,
  type BinanceRestClient,
  type Params,
  type RetryMode,
} from '../src/binance/rest.client.js';
import { BinanceTrading, TradingDisabledError, type OrderRef } from '../src/binance/trading.js';

type Call = { market: string; method: string; path: string; params: Record<string, unknown>; auth: string; retry: string };

function fakeRest(handler: (c: Call) => unknown) {
  const calls: Call[] = [];
  const rest = {
    request: async (
      market: BinanceMarket,
      method: 'GET' | 'POST' | 'PUT' | 'DELETE',
      path: string,
      params: Params,
      auth: Auth,
      retry: RetryMode,
    ) => {
      const c: Call = { market, method, path, params, auth, retry };
      calls.push(c);
      const r = handler(c);
      if (r instanceof Error) throw r;
      return r;
    },
  } as unknown as BinanceRestClient;
  return { rest, calls };
}

const notFound = () => new BinanceError(400, -2013, 'Order does not exist.', 'GET');
const noSleep = async () => {};

function posts(calls: Call[]): Call[] {
  return calls.filter((c) => c.method === 'POST');
}

const ENTRY_CLIENT_ID = 'S-01-1727740800000-entry';

describe('BinanceTrading', () => {
  it('refuses to place when trading is disabled', async () => {
    const { rest, calls } = fakeRest(() => ({}));
    const trading = new BinanceTrading(rest, false, noSleep);

    await expect(
      trading.placeMarket({ market: 'futures', symbol: 'BTCUSDT', side: 'BUY', quantity: new Decimal('0.002'), clientId: ENTRY_CLIENT_ID }),
    ).rejects.toBeInstanceOf(TradingDisabledError);
    await expect(
      trading.placeStop({
        market: 'futures',
        symbol: 'BTCUSDT',
        side: 'SELL',
        quantity: new Decimal('0.002'),
        stopPrice: new Decimal('58816.1'),
        clientId: 'S-01-1727740800000-stop',
      }),
    ).rejects.toBeInstanceOf(TradingDisabledError);
    await expect(trading.ensureFuturesSetup('BTCUSDT', 'isolated', 5)).rejects.toBeInstanceOf(TradingDisabledError);

    expect(calls.length).toBe(0);
  });

  it('futures market order: query first, then send once', async () => {
    const { rest, calls } = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'GET /fapi/v1/order':
          return notFound();
        case 'POST /fapi/v1/order':
          return { orderId: 11, status: 'FILLED', executedQty: '0.002', avgPrice: '84000.5' };
      }
    });
    const trading = new BinanceTrading(rest, true, noSleep);

    const order = await trading.placeMarket({
      market: 'futures',
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: new Decimal('0.002'),
      clientId: ENTRY_CLIENT_ID,
    });

    expect(order.exchangeId).toBe('11');
    expect(order.status).toBe('FILLED');
    expect(order.executedQty.eq('0.002')).toBe(true);
    expect(order.avgPrice?.toString()).toBe('84000.5');

    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.path).toBe('/fapi/v1/order');
    expect(calls[0]!.params).toEqual({ symbol: 'BTCUSDT', origClientOrderId: ENTRY_CLIENT_ID });
    expect(calls[0]!.retry).toBe('safe');

    const post = posts(calls);
    expect(post.length).toBe(1);
    expect(post[0]!.retry).toBe('once');
    expect(post[0]!.auth).toBe('signed');
    expect(post[0]!.params).toEqual({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: '0.002',
      newClientOrderId: ENTRY_CLIENT_ID,
      newOrderRespType: 'RESULT',
    });
  });

  it('same signal twice places exactly one order (AC5)', async () => {
    let stored: unknown = null;
    const { rest, calls } = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'GET /fapi/v1/order':
          return stored ?? notFound();
        case 'POST /fapi/v1/order':
          stored = { orderId: 21, status: 'FILLED', executedQty: '0.002', avgPrice: '84000' };
          return stored;
      }
    });
    const trading = new BinanceTrading(rest, true, noSleep);
    const args = { market: 'futures' as const, symbol: 'BTCUSDT', side: 'BUY' as const, quantity: new Decimal('0.002'), clientId: ENTRY_CLIENT_ID };

    const first = await trading.placeMarket(args);
    const second = await trading.placeMarket(args);

    expect(posts(calls).length).toBe(1);
    expect(second.exchangeId).toBe(first.exchangeId);
  });

  it('partial fill: reports the filled quantity and never re-sends the rest (E2)', async () => {
    let stored: unknown = null;
    const { rest, calls } = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'GET /fapi/v1/order':
          return stored ?? notFound();
        case 'POST /fapi/v1/order':
          // Market order that ran out of liquidity: half filled, rest expired.
          stored = { orderId: 22, status: 'EXPIRED', origQty: '0.002', executedQty: '0.001', avgPrice: '84000' };
          return stored;
      }
    });
    const trading = new BinanceTrading(rest, true, noSleep);
    const args = { market: 'futures' as const, symbol: 'BTCUSDT', side: 'BUY' as const, quantity: new Decimal('0.002'), clientId: ENTRY_CLIENT_ID };

    const first = await trading.placeMarket(args);
    expect(first.status).toBe('EXPIRED');
    expect(first.executedQty.toString()).toBe('0.001');

    // A retry of the same signal finds the order and does not send the missing 0.001.
    const again = await trading.placeMarket(args);
    expect(again.executedQty.toString()).toBe('0.001');
    expect(posts(calls).length).toBe(1);
  });

  it('unclear send is resolved by querying, not resending', async () => {
    let queries = 0;
    const { rest, calls } = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'GET /fapi/v1/order':
          queries += 1;
          return queries === 1 ? notFound() : { orderId: 12, status: 'FILLED', executedQty: '0.002', avgPrice: '84000' };
        case 'POST /fapi/v1/order':
          return new UnknownOutcomeError('POST /fapi/v1/order', 'HTTP 503');
      }
    });
    const trading = new BinanceTrading(rest, true, noSleep);

    const order = await trading.placeMarket({
      market: 'futures',
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: new Decimal('0.002'),
      clientId: ENTRY_CLIENT_ID,
    });

    expect(order.exchangeId).toBe('12');
    expect(posts(calls).length).toBe(1);
  });

  it('duplicate-ID rejection is resolved by querying', async () => {
    let queries = 0;
    const found = { orderId: 13, status: 'FILLED', executedQty: '0.002', avgPrice: '84000' };
    const { rest, calls } = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'GET /fapi/v1/order':
          queries += 1;
          return queries === 1 ? notFound() : found;
        case 'POST /fapi/v1/order':
          return new BinanceError(400, -4116, 'ClientOrderId is duplicated.', 'POST');
      }
    });
    const trading = new BinanceTrading(rest, true, noSleep);

    const order = await trading.placeMarket({
      market: 'futures',
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: new Decimal('0.002'),
      clientId: ENTRY_CLIENT_ID,
    });

    expect(order.exchangeId).toBe('13');
    expect(posts(calls).length).toBe(1);
  });

  it('gives up after 3 unclear sends', async () => {
    const { rest, calls } = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'GET /fapi/v1/order':
          return notFound();
        case 'POST /fapi/v1/order':
          return new UnknownOutcomeError('POST /fapi/v1/order', 'HTTP 503');
      }
    });
    const trading = new BinanceTrading(rest, true, noSleep);

    await expect(
      trading.placeMarket({ market: 'futures', symbol: 'BTCUSDT', side: 'BUY', quantity: new Decimal('0.002'), clientId: ENTRY_CLIENT_ID }),
    ).rejects.toBeInstanceOf(UnknownOutcomeError);
    expect(posts(calls).length).toBe(3);
  });

  it('a definite rejection is not retried', async () => {
    const { rest, calls } = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'GET /fapi/v1/order':
          return notFound();
        case 'POST /fapi/v1/order':
          return new BinanceError(400, -2019, 'Margin is insufficient.', 'POST');
      }
    });
    const trading = new BinanceTrading(rest, true, noSleep);

    await expect(
      trading.placeMarket({ market: 'futures', symbol: 'BTCUSDT', side: 'BUY', quantity: new Decimal('0.002'), clientId: ENTRY_CLIENT_ID }),
    ).rejects.toMatchObject({ code: -2019 });
    expect(posts(calls).length).toBe(1);
  });

  it('spot market BUY uses FULL and computes the average from the quote total', async () => {
    const { rest, calls } = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'GET /api/v3/order':
          return notFound();
        case 'POST /api/v3/order':
          return { orderId: 5, status: 'FILLED', executedQty: '0.0002', cummulativeQuoteQty: '16.8' };
      }
    });
    const trading = new BinanceTrading(rest, true, noSleep);

    const order = await trading.placeMarket({
      market: 'spot',
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: new Decimal('0.0002'),
      clientId: ENTRY_CLIENT_ID,
    });

    expect(order.avgPrice?.toString()).toBe('84000');
    const post = posts(calls)[0]!;
    expect(post.params.newOrderRespType).toBe('FULL');

    await expect(
      trading.placeMarket({ market: 'spot', symbol: 'BTCUSDT', side: 'BUY', quantity: new Decimal('0.0002'), clientId: ENTRY_CLIENT_ID, reduceOnly: true }),
    ).rejects.toThrow(/USDⓈ-M only/);
  });

  it('futures stop is a reduce-only mark-price algo order', async () => {
    const { rest, calls } = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'GET /fapi/v1/algoOrder':
          return notFound();
        case 'POST /fapi/v1/algoOrder':
          return { algoId: 99, algoStatus: 'NEW' };
      }
    });
    const trading = new BinanceTrading(rest, true, noSleep);

    const order = await trading.placeStop({
      market: 'futures',
      symbol: 'BTCUSDT',
      side: 'SELL',
      quantity: new Decimal('0.002'),
      stopPrice: new Decimal('58816.1'),
      clientId: 'S-01-1727740800000-stop',
    });

    expect(order.exchangeId).toBe('99');
    expect(order.status).toBe('NEW');
    expect(order.executedQty.eq(0)).toBe(true);

    const query = calls.find((c) => c.method === 'GET')!;
    expect(query.path).toBe('/fapi/v1/algoOrder');
    expect(query.params).toEqual({ clientAlgoId: 'S-01-1727740800000-stop' });

    const post = posts(calls)[0]!;
    expect(post.path).toBe('/fapi/v1/algoOrder');
    expect(post.params).toEqual({
      algoType: 'CONDITIONAL',
      symbol: 'BTCUSDT',
      side: 'SELL',
      type: 'STOP_MARKET',
      quantity: '0.002',
      triggerPrice: '58816.1',
      workingType: 'MARK_PRICE',
      reduceOnly: 'true',
      clientAlgoId: 'S-01-1727740800000-stop',
    });
  });

  it('futures take-profit', async () => {
    const { rest, calls } = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'GET /fapi/v1/algoOrder':
          return notFound();
        case 'POST /fapi/v1/algoOrder':
          return { algoId: 99, algoStatus: 'NEW' };
      }
    });
    const trading = new BinanceTrading(rest, true, noSleep);

    await trading.placeFuturesTakeProfit({
      symbol: 'BTCUSDT',
      side: 'SELL',
      quantity: new Decimal('0.002'),
      stopPrice: new Decimal('90000'),
      clientId: 'S-01-1727740800000-tp',
    });

    const post = posts(calls)[0]!;
    expect(post.params.type).toBe('TAKE_PROFIT_MARKET');
    expect(post.params.reduceOnly).toBe('true');
  });

  it('spot stop', async () => {
    const { rest } = fakeRest(() => ({}));
    const trading = new BinanceTrading(rest, true, noSleep);
    await expect(
      trading.placeStop({
        market: 'spot',
        symbol: 'BTCUSDT',
        side: 'BUY',
        quantity: new Decimal('0.00019'),
        stopPrice: new Decimal('58816.12'),
        clientId: 'S-01-1727740800000-stop',
      }),
    ).rejects.toThrow(/long only/);

    const { rest: rest2, calls } = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'GET /api/v3/order':
          return notFound();
        case 'POST /api/v3/order':
          return { orderId: 6, status: 'NEW', executedQty: '0', cummulativeQuoteQty: '0' };
      }
    });
    const trading2 = new BinanceTrading(rest2, true, noSleep);

    await trading2.placeStop({
      market: 'spot',
      symbol: 'BTCUSDT',
      side: 'SELL',
      quantity: new Decimal('0.00019'),
      stopPrice: new Decimal('58816.12'),
      clientId: 'S-01-1727740800000-stop',
    });

    const post = posts(calls)[0]!;
    expect(post.path).toBe('/api/v3/order');
    expect(post.params).toMatchObject({ type: 'STOP_LOSS', stopPrice: '58816.12', side: 'SELL' });
  });

  it('spot OCO', async () => {
    const { rest, calls } = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'GET /api/v3/orderList':
          return new BinanceError(400, -2018, 'Order list does not exist.', 'GET');
        case 'POST /api/v3/orderList/oco':
          return { orderListId: 7, listOrderStatus: 'EXECUTING' };
      }
    });
    const trading = new BinanceTrading(rest, true, noSleep);

    const order = await trading.placeSpotOco({
      symbol: 'BTCUSDT',
      quantity: new Decimal('0.00019'),
      stopPrice: new Decimal('80000'),
      takeProfitPrice: new Decimal('90000'),
      listClientId: 'S-01-1-oco',
      stopClientId: 'S-01-1-stop',
      takeProfitClientId: 'S-01-1-tp',
    });

    expect(order.exchangeId).toBe('7');
    expect(order.status).toBe('EXECUTING');

    const query = calls.find((c) => c.method === 'GET')!;
    expect(query.path).toBe('/api/v3/orderList');
    expect(query.params).toEqual({ origClientOrderId: 'S-01-1-oco' });

    const post = posts(calls)[0]!;
    expect(post.path).toBe('/api/v3/orderList/oco');
    expect(post.params).toEqual({
      symbol: 'BTCUSDT',
      side: 'SELL',
      quantity: '0.00019',
      listClientOrderId: 'S-01-1-oco',
      aboveType: 'LIMIT_MAKER',
      abovePrice: '90000',
      aboveClientOrderId: 'S-01-1-tp',
      belowType: 'STOP_LOSS',
      belowStopPrice: '80000',
      belowClientOrderId: 'S-01-1-stop',
    });
  });

  it('cancel', async () => {
    const { rest, calls } = fakeRest(() => ({}));
    const trading = new BinanceTrading(rest, true, noSleep);
    const algoRef: OrderRef = { market: 'futures', kind: 'algo', symbol: 'BTCUSDT', clientId: 'x' };
    const ocoRef: OrderRef = { market: 'spot', kind: 'oco', symbol: 'BTCUSDT', clientId: 'y' };

    expect(await trading.cancel(algoRef)).toBe('canceled');
    expect(await trading.cancel(ocoRef)).toBe('canceled');
    expect(calls[0]!.path).toBe('/fapi/v1/algoOrder');
    expect(calls[0]!.params).toEqual({ clientAlgoId: 'x' });
    expect(calls[1]!.path).toBe('/api/v3/orderList');
    expect(calls[1]!.params).toEqual({ symbol: 'BTCUSDT', listClientOrderId: 'y' });

    const { rest: rest2 } = fakeRest((c) => {
      if (c.method === 'DELETE') return new BinanceError(400, -2011, 'Unknown order sent.', 'DELETE');
      return {};
    });
    expect(await new BinanceTrading(rest2, true, noSleep).cancel(algoRef)).toBe('not_open');

    const { rest: rest3 } = fakeRest((c) => {
      if (c.method === 'DELETE') return new BinanceError(400, -1100, 'Illegal characters', 'DELETE');
      return {};
    });
    await expect(new BinanceTrading(rest3, true, noSleep).cancel(algoRef)).rejects.toMatchObject({ code: -1100 });
  });

  it('spot equity in USDT', async () => {
    const { rest } = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'GET /api/v3/account':
          return {
            balances: [
              { asset: 'USDT', free: '100', locked: '50' },
              { asset: 'BTC', free: '0.01', locked: '0' },
              { asset: 'XYZ', free: '5', locked: '0' },
            ],
          };
        case 'GET /api/v3/ticker/price':
          return [
            { symbol: 'BTCUSDT', price: '80000' },
            { symbol: 'ETHUSDT', price: '3000' },
          ];
      }
    });
    const trading = new BinanceTrading(rest, true, noSleep);

    expect((await trading.spotEquityUsdt()).toString()).toBe('950');
  });

  it('fills since the entry are paged past 1000 (PnL of a long-lived position)', async () => {
    const raw = (id: number) => ({ id, orderId: 1, side: 'BUY', qty: '1', price: '1', quoteQty: '1', commission: '0', commissionAsset: 'USDT', realizedPnl: '0', time: id });
    const { rest, calls } = fakeRest((c) => {
      if (c.params.orderId !== undefined) return [raw(500), raw(501)];
      const from = Number(c.params.fromId);
      if (from === 500) return Array.from({ length: 1000 }, (_, i) => raw(500 + i));
      if (from === 1500) return [raw(1500), raw(1501)];
      return new Error(`unexpected fromId ${from}`);
    });
    const fills = await new BinanceTrading(rest, true, noSleep).fillsSince('futures', 'BTCUSDT', '1');
    expect(fills).toHaveLength(1002);
    expect(calls.map((c) => c.params.fromId)).toEqual([undefined, 500, 1500]);
  });

  it('spot received quantity subtracts base-asset commission', async () => {
    const state = {
      ref: { market: 'spot' as const, kind: 'order' as const, symbol: 'BTCUSDT', clientId: 'c' },
      exchangeId: '5',
      status: 'FILLED',
      executedQty: new Decimal('0.0002'),
      avgPrice: null,
    };

    const { rest, calls } = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'GET /api/v3/myTrades':
          return [{ qty: '0.0002', commission: '0.0000002', commissionAsset: 'BTC' }];
      }
    });
    expect((await new BinanceTrading(rest, true, noSleep).spotReceivedQuantity(state, 'BTC')).toString()).toBe('0.0001998');
    expect(calls[0]!.params).toEqual({ symbol: 'BTCUSDT', orderId: '5' });

    const { rest: rest2 } = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'GET /api/v3/myTrades':
          return [{ qty: '0.0002', commission: '0.0000002', commissionAsset: 'BNB' }];
      }
    });
    expect((await new BinanceTrading(rest2, true, noSleep).spotReceivedQuantity(state, 'BTC')).toString()).toBe('0.0002');
  });

  it('futures exit: nothing sent when already flat (E7)', async () => {
    const { rest, calls } = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'GET /fapi/v3/positionRisk':
          return [{ symbol: 'BTCUSDT', positionAmt: '0', entryPrice: '0', liquidationPrice: '0' }];
      }
    });
    const trading = new BinanceTrading(rest, true, noSleep);

    await expect(trading.closeFuturesPosition('BTCUSDT', 'S-01-2-exit')).resolves.toEqual({ kind: 'already_closed' });
    expect(posts(calls).length).toBe(0);
  });

  it('futures exit closes a short reduce-only', async () => {
    const { rest, calls } = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'GET /fapi/v3/positionRisk':
          return [{ symbol: 'BTCUSDT', positionAmt: '-0.002', entryPrice: '84000', liquidationPrice: '80000' }];
        case 'GET /fapi/v1/order':
          return notFound();
        case 'POST /fapi/v1/order':
          return { orderId: 31, status: 'FILLED', executedQty: '0.002', avgPrice: '84000' };
      }
    });
    const trading = new BinanceTrading(rest, true, noSleep);

    const result = await trading.closeFuturesPosition('BTCUSDT', 'S-01-2-exit');

    expect(result.kind).toBe('closed');
    const post = posts(calls);
    expect(post.length).toBe(1);
    expect(post[0]!.path).toBe('/fapi/v1/order');
    expect(post[0]!.params).toMatchObject({ side: 'BUY', quantity: '0.002', reduceOnly: 'true' });
  });

  it('spot exit after the stop filled sells nothing, even with other BTC in the wallet (E7, B11.3)', async () => {
    const { rest, calls } = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'DELETE /api/v3/order':
          return new BinanceError(400, -2011, 'Unknown order sent.', 'DELETE');
        case 'GET /api/v3/order':
          return { orderId: 3, status: 'FILLED', executedQty: '0.00019', cummulativeQuoteQty: '15.2' };
        case 'GET /api/v3/account':
          return { balances: [{ asset: 'BTC', free: '0.5', locked: '0' }] };
      }
    });
    const trading = new BinanceTrading(rest, true, noSleep);

    const result = await trading.closeSpotPosition({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quantity: new Decimal('0.00019'),
      protective: [{ market: 'spot', kind: 'order', symbol: 'BTCUSDT', clientId: 'S-01-1-stop' }],
      clientId: 'S-01-2-exit',
    });

    expect(result).toEqual({ kind: 'already_closed' });
    expect(posts(calls).length).toBe(0);
  });

  it('spot exit sells the held quantity after cancelling the stop', async () => {
    const { rest, calls } = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'DELETE /api/v3/order':
          return {};
        case 'GET /api/v3/order':
          if (c.params.origClientOrderId === 'S-01-1-stop') {
            return { orderId: 3, status: 'CANCELED', executedQty: '0', cummulativeQuoteQty: '0' };
          }
          return notFound();
        case 'GET /api/v3/account':
          return { balances: [{ asset: 'BTC', free: '0.00019', locked: '0' }] };
        case 'POST /api/v3/order':
          return { orderId: 4, status: 'FILLED', executedQty: '0.00019', cummulativeQuoteQty: '15.2' };
      }
    });
    const trading = new BinanceTrading(rest, true, noSleep);

    const result = await trading.closeSpotPosition({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quantity: new Decimal('0.00019'),
      protective: [{ market: 'spot', kind: 'order', symbol: 'BTCUSDT', clientId: 'S-01-1-stop' }],
      clientId: 'S-01-2-exit',
    });

    expect(result.kind).toBe('closed');
    const post = posts(calls)[0]!;
    expect(post.params.quantity).toBe('0.00019');
    expect(post.params.side).toBe('SELL');
  });

  it('futures setup', async () => {
    const hedge = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'GET /fapi/v1/positionSide/dual':
          return { dualSidePosition: true };
      }
    });
    await expect(new BinanceTrading(hedge.rest, true, noSleep).ensureFuturesSetup('BTCUSDT', 'isolated', 5)).rejects.toThrow(/hedge mode/);

    const ok = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'GET /fapi/v1/positionSide/dual':
          return { dualSidePosition: false };
        case 'POST /fapi/v1/marginType':
          return new BinanceError(400, -4046, 'No need to change margin type.', 'POST');
        case 'POST /fapi/v1/leverage':
          return { leverage: 5 };
        case 'GET /fapi/v1/symbolConfig':
          return [{ symbol: 'BTCUSDT', marginType: 'ISOLATED', leverage: 5 }];
      }
    });
    await expect(new BinanceTrading(ok.rest, true, noSleep).ensureFuturesSetup('BTCUSDT', 'isolated', 5)).resolves.toBeUndefined();
    const marginType = ok.calls.find((c) => c.method === 'POST' && c.path === '/fapi/v1/marginType')!;
    expect(marginType.params).toEqual({ symbol: 'BTCUSDT', marginType: 'ISOLATED' });

    const stale = fakeRest((c) => {
      switch (c.method + ' ' + c.path) {
        case 'GET /fapi/v1/positionSide/dual':
          return { dualSidePosition: false };
        case 'POST /fapi/v1/marginType':
          return new BinanceError(400, -4046, 'No need to change margin type.', 'POST');
        case 'POST /fapi/v1/leverage':
          return { leverage: 5 };
        case 'GET /fapi/v1/symbolConfig':
          return [{ symbol: 'BTCUSDT', marginType: 'ISOLATED', leverage: 20 }];
      }
    });
    await expect(new BinanceTrading(stale.rest, true, noSleep).ensureFuturesSetup('BTCUSDT', 'isolated', 5)).rejects.toThrow(/not applied/);
  });
});
