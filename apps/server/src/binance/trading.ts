import { Decimal } from 'decimal.js';
import type { LeverageBracket } from '@cane/core';
import type { BinanceMarket } from './endpoints.js';
import { parseFuturesSymbol, parseLeverageBrackets, parseSpotSymbol, type SymbolInfo } from './exchange-info.js';
import { BinanceError, UnknownOutcomeError, type BinanceRestClient, type Params, type SleepFn } from './rest.client.js';

export type OrderSide = 'BUY' | 'SELL';

/**
 * How an order is addressed on Binance: `order` = plain spot/USDⓈ-M order
 * (`clientOrderId`), `algo` = USDⓈ-M Algo Order (`clientAlgoId`), `oco` =
 * spot order list (`listClientOrderId`).
 */
export type OrderKind = 'order' | 'algo' | 'oco';

export interface OrderRef {
  market: BinanceMarket;
  kind: OrderKind;
  symbol: string;
  clientId: string;
}

/** Binance's view of one order. `status` is passed through as Binance reports it. */
export interface OrderState {
  ref: OrderRef;
  exchangeId: string;
  status: string;
  /** Filled quantity (0 for algo and oco, whose fills show on the triggered order). */
  executedQty: Decimal;
  /** Average fill price, or null before any fill. */
  avgPrice: Decimal | null;
}

/** One own fill (spot `myTrades` / USDⓈ-M `userTrades`). */
export interface Fill {
  orderId: string;
  buy: boolean;
  qty: Decimal;
  price: Decimal;
  quoteQty: Decimal;
  commission: Decimal;
  commissionAsset: string;
  /** USDⓈ-M only: Binance's realised PnL of this fill (fees not included). */
  realizedPnl: Decimal | null;
  time: number;
}

interface RawFill {
  id: number;
  orderId: number;
  isBuyer?: boolean;
  side?: string;
  qty: string;
  price: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  realizedPnl?: string;
  time: number;
}

export type ExitResult = { kind: 'closed'; order: OrderState } | { kind: 'already_closed' };

export class TradingDisabledError extends Error {
  constructor(action: string) {
    super(`TRADING_ENABLED is not true: refusing to ${action}`);
    this.name = 'TradingDisabledError';
  }
}

/** Binance codes meaning "no such order / order list". */
const NOT_FOUND = new Set([-2013, -2018]);
/** Binance `-2011`: cancel of an order that is not open (unknown, filled or already canceled). */
const CANCEL_NOT_OPEN = -2011;
/** Duplicate client ID among open orders: spot `-2010` "Duplicate order sent.", USDⓈ-M `-4116`. */
const DUPLICATE = new Set([-2010, -4116]);
/** Binance `-4046`: margin type already set. */
const MARGIN_TYPE_UNCHANGED = -4046;

const PLACE_ATTEMPTS = 3;
const FILLS_PAGE = 1000;
const RESEND_DELAY_MS = 1000;

/**
 * Orders and account reads on Binance spot and USDⓈ-M for one API key.
 * Every placement is query-before-send by client ID (E1), so a resend after a
 * timeout or restart never creates a second order. Order-placing calls are
 * refused unless `tradingEnabled` (plan feature flag `TRADING_ENABLED`).
 */
export class BinanceTrading {
  constructor(
    private readonly rest: BinanceRestClient,
    private readonly tradingEnabled: boolean,
    private readonly sleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  // --- Placement ---

  /** Market order; USDⓈ-M exits pass `reduceOnly`. Returns the final fill (spot FULL / USDⓈ-M RESULT). */
  async placeMarket(args: {
    market: BinanceMarket;
    symbol: string;
    side: OrderSide;
    quantity: Decimal;
    clientId: string;
    reduceOnly?: boolean;
  }): Promise<OrderState> {
    const ref: OrderRef = { market: args.market, kind: 'order', symbol: args.symbol, clientId: args.clientId };
    const params: Params = {
      symbol: args.symbol,
      side: args.side,
      type: 'MARKET',
      quantity: args.quantity.toFixed(),
      newClientOrderId: args.clientId,
    };
    if (args.market === 'spot') {
      if (args.reduceOnly) throw new Error('reduceOnly is USDⓈ-M only');
      params.newOrderRespType = 'FULL';
    } else {
      params.newOrderRespType = 'RESULT';
      if (args.reduceOnly) params.reduceOnly = 'true';
    }
    return this.findOrPlace(ref, 'place a market order', params);
  }

  /**
   * Protective stop (B5.1). Spot: STOP_LOSS sell for the quantity held.
   * USDⓈ-M: Algo Order STOP_MARKET, reduce-only, triggered by mark price
   * (liquidation also uses mark price, so the B9.2 buffer holds).
   */
  async placeStop(args: {
    market: BinanceMarket;
    symbol: string;
    side: OrderSide;
    quantity: Decimal;
    stopPrice: Decimal;
    clientId: string;
  }): Promise<OrderState> {
    if (args.market === 'spot') {
      if (args.side !== 'SELL') throw new Error('spot is long only: a stop must SELL');
      return this.findOrPlace({ market: 'spot', kind: 'order', symbol: args.symbol, clientId: args.clientId }, 'place a stop', {
        symbol: args.symbol,
        side: 'SELL',
        type: 'STOP_LOSS',
        quantity: args.quantity.toFixed(),
        stopPrice: args.stopPrice.toFixed(),
        newClientOrderId: args.clientId,
        newOrderRespType: 'RESULT',
      });
    }
    return this.placeAlgo('STOP_MARKET', args);
  }

  /** USDⓈ-M take-profit for late entries (B4.3): Algo TAKE_PROFIT_MARKET, reduce-only, mark price. */
  async placeFuturesTakeProfit(args: {
    symbol: string;
    side: OrderSide;
    quantity: Decimal;
    stopPrice: Decimal;
    clientId: string;
  }): Promise<OrderState> {
    return this.placeAlgo('TAKE_PROFIT_MARKET', { ...args, market: 'futures' });
  }

  /**
   * Spot late entry stop + take-profit on one locked balance: a SELL OCO with
   * a LIMIT_MAKER take-profit above and a STOP_LOSS below.
   */
  async placeSpotOco(args: {
    symbol: string;
    quantity: Decimal;
    stopPrice: Decimal;
    takeProfitPrice: Decimal;
    listClientId: string;
    stopClientId: string;
    takeProfitClientId: string;
  }): Promise<OrderState> {
    return this.findOrPlace(
      { market: 'spot', kind: 'oco', symbol: args.symbol, clientId: args.listClientId },
      'place an OCO',
      {
        symbol: args.symbol,
        side: 'SELL',
        quantity: args.quantity.toFixed(),
        listClientOrderId: args.listClientId,
        aboveType: 'LIMIT_MAKER',
        abovePrice: args.takeProfitPrice.toFixed(),
        aboveClientOrderId: args.takeProfitClientId,
        belowType: 'STOP_LOSS',
        belowStopPrice: args.stopPrice.toFixed(),
        belowClientOrderId: args.stopClientId,
      },
    );
  }

  private placeAlgo(
    type: 'STOP_MARKET' | 'TAKE_PROFIT_MARKET',
    args: { market: BinanceMarket; symbol: string; side: OrderSide; quantity: Decimal; stopPrice: Decimal; clientId: string },
  ): Promise<OrderState> {
    return this.findOrPlace({ market: 'futures', kind: 'algo', symbol: args.symbol, clientId: args.clientId }, `place a ${type}`, {
      algoType: 'CONDITIONAL',
      symbol: args.symbol,
      side: args.side,
      type,
      quantity: args.quantity.toFixed(),
      triggerPrice: args.stopPrice.toFixed(),
      workingType: 'MARK_PRICE',
      reduceOnly: 'true',
      clientAlgoId: args.clientId,
    });
  }

  /**
   * E1: look the client ID up first; send only if Binance has never seen it.
   * An unclear send (timeout, 5xx) or a duplicate-ID rejection is resolved by
   * querying again before any resend with the same ID.
   */
  private async findOrPlace(ref: OrderRef, action: string, params: Params): Promise<OrderState> {
    if (!this.tradingEnabled) throw new TradingDisabledError(action);
    for (let attempt = 1; ; attempt++) {
      const existing = await this.query(ref);
      if (existing) return existing;
      try {
        const body = await this.rest.request(ref.market, 'POST', orderPath(ref, 'place'), params, 'signed', 'once');
        const placed = parseOrder(ref, body);
        // A USDⓈ-M RESULT response has no average price; the order query does.
        if (placed.executedQty.gt(0) && !placed.avgPrice) return (await this.query(ref)) ?? placed;
        return placed;
      } catch (err) {
        const duplicate = err instanceof BinanceError && err.code !== null && DUPLICATE.has(err.code);
        if (!(err instanceof UnknownOutcomeError) && !duplicate) throw err;
        if (attempt >= PLACE_ATTEMPTS) throw err;
        await this.sleep(RESEND_DELAY_MS * attempt);
      }
    }
  }

  // --- Exits (B7.3, E7) ---

  /**
   * Closes the one-way USDⓈ-M position with a reduce-only market order. If
   * the position is already flat (stop or take-profit filled first, E7), no
   * order is sent. Remaining protective orders are the caller's to cancel (B7.3).
   */
  async closeFuturesPosition(symbol: string, clientId: string): Promise<ExitResult> {
    const { amount } = await this.futuresPosition(symbol);
    if (amount.isZero()) return { kind: 'already_closed' };
    const order = await this.placeMarket({
      market: 'futures',
      symbol,
      side: amount.gt(0) ? 'SELL' : 'BUY',
      quantity: amount.abs(),
      clientId,
      reduceOnly: true,
    });
    return { kind: 'closed', order };
  }

  /**
   * Closes a spot long: cancels its protective orders (stop or OCO) to unlock
   * the balance, then sells what is left of `quantity` at market. Quantity
   * already sold by those protective orders (E7) is not sold again, and the
   * sale is capped at the free base balance. Only fills of the strategy's own
   * orders count, so the owner's other holdings are never sold (B11.3).
   */
  async closeSpotPosition(args: {
    symbol: string;
    baseAsset: string;
    quantity: Decimal;
    protective: OrderRef[];
    clientId: string;
  }): Promise<ExitResult> {
    let alreadySold = new Decimal(0);
    for (const ref of args.protective) {
      await this.cancel(ref);
      alreadySold = alreadySold.plus(await this.soldBy(ref));
    }
    const free = (await this.spotBalances()).get(args.baseAsset)?.free ?? new Decimal(0);
    const quantity = Decimal.min(args.quantity.minus(alreadySold), free);
    if (quantity.lte(0)) return { kind: 'already_closed' };
    const order = await this.placeMarket({ market: 'spot', symbol: args.symbol, side: 'SELL', quantity, clientId: args.clientId });
    return { kind: 'closed', order };
  }

  /** Base quantity a spot protective order (or both legs of an OCO) has filled. */
  private async soldBy(ref: OrderRef): Promise<Decimal> {
    if (ref.kind !== 'oco') return (await this.query(ref))?.executedQty ?? new Decimal(0);
    const list = (await this.rest.request('spot', 'GET', '/api/v3/orderList', idParams(ref, 'query'), 'signed', 'safe')) as {
      orders?: { clientOrderId: string }[];
    };
    let sold = new Decimal(0);
    for (const leg of list.orders ?? []) {
      const state = await this.query({ market: 'spot', kind: 'order', symbol: ref.symbol, clientId: leg.clientOrderId });
      sold = sold.plus(state?.executedQty ?? 0);
    }
    return sold;
  }

  // --- Query and cancel ---

  /** The order's current state, or null if Binance does not know the client ID. */
  async query(ref: OrderRef): Promise<OrderState | null> {
    try {
      const body = await this.rest.request(ref.market, 'GET', orderPath(ref, 'query'), idParams(ref, 'query'), 'signed', 'safe');
      return parseOrder(ref, body);
    } catch (err) {
      if (err instanceof BinanceError && err.code !== null && NOT_FOUND.has(err.code)) return null;
      throw err;
    }
  }

  /**
   * Cancels an open order. Returns `canceled`, or `not_open` when Binance says
   * the order is not open (already filled, canceled or unknown) — the caller
   * queries to tell which (E7).
   */
  async cancel(ref: OrderRef): Promise<'canceled' | 'not_open'> {
    try {
      await this.rest.request(ref.market, 'DELETE', orderPath(ref, 'query'), idParams(ref, 'cancel'), 'signed', 'safe');
      return 'canceled';
    } catch (err) {
      if (err instanceof BinanceError && (err.code === CANCEL_NOT_OPEN || (err.code !== null && NOT_FOUND.has(err.code)))) {
        return 'not_open';
      }
      throw err;
    }
  }

  /**
   * Base quantity a spot BUY actually delivered: filled quantity minus
   * commission charged in the base asset (Binance takes the BUY fee in the
   * bought coin unless paid in BNB). The protective stop is sized to this,
   * rounded down to the step (B5.1, E2) — a stop for the gross quantity is
   * rejected for insufficient balance.
   */
  async spotReceivedQuantity(state: OrderState, baseAsset: string): Promise<Decimal> {
    if (state.ref.market !== 'spot' || state.ref.kind !== 'order') throw new Error('spot orders only');
    const trades = (await this.rest.request(
      'spot',
      'GET',
      '/api/v3/myTrades',
      { symbol: state.ref.symbol, orderId: state.exchangeId },
      'signed',
      'safe',
    )) as { qty: string; commission: string; commissionAsset: string }[];
    if (!Array.isArray(trades)) throw new Error('Invalid myTrades response');
    let received = new Decimal(0);
    for (const t of trades) {
      received = received.plus(dec(t.qty));
      if (t.commissionAsset === baseAsset) received = received.minus(dec(t.commission));
    }
    return received;
  }

  /**
   * Fills of the symbol from the first fill of `orderId` onward (the entry),
   * so a position's whole life is covered without Binance's 24 h (spot) /
   * 7 day (USDⓈ-M) time-window limits.
   */
  async fillsSince(market: BinanceMarket, symbol: string, orderId: string): Promise<Fill[]> {
    const path = market === 'spot' ? '/api/v3/myTrades' : '/fapi/v1/userTrades';
    const first = (await this.rest.request(market, 'GET', path, { symbol, orderId }, 'signed', 'safe')) as RawFill[];
    if (!Array.isArray(first)) throw new Error('Invalid trades response');
    if (first.length === 0) return [];
    const all: RawFill[] = [];
    for (let fromId = Math.min(...first.map((t) => t.id)); ; ) {
      const page = (await this.rest.request(market, 'GET', path, { symbol, fromId, limit: FILLS_PAGE }, 'signed', 'safe')) as RawFill[];
      if (!Array.isArray(page)) throw new Error('Invalid trades response');
      all.push(...page);
      if (page.length < FILLS_PAGE) break;
      fromId = Math.max(...page.map((t) => t.id)) + 1;
    }
    return all.map((t) => ({
      orderId: String(t.orderId),
      buy: market === 'spot' ? t.isBuyer === true : t.side === 'BUY',
      qty: dec(t.qty),
      price: dec(t.price),
      quoteQty: dec(t.quoteQty),
      commission: dec(t.commission),
      commissionAsset: String(t.commissionAsset),
      realizedPnl: market === 'futures' ? dec(t.realizedPnl) : null,
      time: t.time,
    }));
  }

  /** E9: whether Binance liquidated a USDⓈ-M position on the symbol since `startTime`. */
  async futuresLiquidatedSince(symbol: string, startTime: number): Promise<boolean> {
    const rows = (await this.rest.request('futures', 'GET', '/fapi/v1/forceOrders', { symbol, startTime, autoCloseType: 'LIQUIDATION' }, 'signed', 'safe')) as unknown[];
    if (!Array.isArray(rows)) throw new Error('Invalid forceOrders response');
    return rows.length > 0;
  }

  /** USDⓈ-M funding paid (< 0) or received (> 0) for the symbol in [startTime, endTime]. */
  async futuresFunding(symbol: string, startTime: number, endTime: number): Promise<Decimal> {
    const rows = (await this.rest.request(
      'futures',
      'GET',
      '/fapi/v1/income',
      { symbol, incomeType: 'FUNDING_FEE', startTime, endTime, limit: 1000 },
      'signed',
      'safe',
    )) as { income: string }[];
    if (!Array.isArray(rows)) throw new Error('Invalid income response');
    return rows.reduce((sum, r) => sum.plus(dec(r.income)), new Decimal(0));
  }

  // --- Exchange rules ---

  /** Symbol status and filters (B6.6 rounding, min notional; E8 halted when status is not TRADING). */
  async symbolInfo(market: BinanceMarket, symbol: string): Promise<SymbolInfo> {
    if (market === 'spot') {
      return parseSpotSymbol(await this.rest.request('spot', 'GET', '/api/v3/exchangeInfo', { symbol }, 'none', 'safe'), symbol);
    }
    // USDⓈ-M exchangeInfo has no symbol filter parameter.
    return parseFuturesSymbol(await this.rest.request('futures', 'GET', '/fapi/v1/exchangeInfo', {}, 'none', 'safe'), symbol);
  }

  /** USDⓈ-M leverage brackets for the B9.2 liquidation check. */
  async leverageBrackets(symbol: string): Promise<LeverageBracket[]> {
    return parseLeverageBrackets(await this.rest.request('futures', 'GET', '/fapi/v1/leverageBracket', { symbol }, 'signed', 'safe'), symbol);
  }

  /**
   * Client IDs of the symbol's open orders (plain, algo and OCO lists). This
   * is the check for "is the stop still there" (B12.2): the single algo-order
   * query can report NEW for about two seconds after a cancel (Demo check),
   * while the open lists are current.
   */
  async openClientIds(market: BinanceMarket, symbol: string): Promise<Set<string>> {
    const ids = new Set<string>();
    if (market === 'futures') {
      const [orders, algos] = await Promise.all([
        this.rest.request('futures', 'GET', '/fapi/v1/openOrders', { symbol }, 'signed', 'safe') as Promise<{ clientOrderId: string }[]>,
        this.rest.request('futures', 'GET', '/fapi/v1/openAlgoOrders', { symbol }, 'signed', 'safe') as Promise<{ clientAlgoId: string }[]>,
      ]);
      for (const o of orders) ids.add(o.clientOrderId);
      for (const a of algos) ids.add(a.clientAlgoId);
      return ids;
    }
    const [orders, lists] = await Promise.all([
      this.rest.request('spot', 'GET', '/api/v3/openOrders', { symbol }, 'signed', 'safe') as Promise<{ clientOrderId: string }[]>,
      this.rest.request('spot', 'GET', '/api/v3/openOrderList', {}, 'signed', 'safe') as Promise<{ symbol: string; listClientOrderId: string }[]>,
    ]);
    for (const o of orders) ids.add(o.clientOrderId);
    for (const l of lists) if (l.symbol === symbol) ids.add(l.listClientOrderId);
    return ids;
  }

  // --- Account ---

  /** Spot balances (free + locked) per asset, zero balances omitted. */
  async spotBalances(): Promise<Map<string, { free: Decimal; locked: Decimal }>> {
    const body = (await this.rest.request('spot', 'GET', '/api/v3/account', { omitZeroBalances: 'true' }, 'signed', 'safe')) as {
      balances?: { asset: string; free: string; locked: string }[];
    };
    if (!Array.isArray(body.balances)) throw new Error('Invalid spot account response');
    return new Map(body.balances.map((b) => [b.asset, { free: dec(b.free), locked: dec(b.locked) }]));
  }

  /**
   * B6.3 spot equity: total spot wallet value in USDT = Σ (free + locked) ×
   * last price of `<asset>USDT`; USDT counts 1:1. Assets without a USDT pair
   * are left out (they cannot be sized against anyway).
   */
  async spotEquityUsdt(): Promise<Decimal> {
    const [balances, prices] = await Promise.all([this.spotBalances(), this.spotPrices()]);
    let total = new Decimal(0);
    for (const [asset, b] of balances) {
      const amount = b.free.plus(b.locked);
      if (asset === 'USDT') total = total.plus(amount);
      else {
        const price = prices.get(`${asset}USDT`);
        if (price) total = total.plus(amount.times(price));
      }
    }
    return total;
  }

  private async spotPrices(): Promise<Map<string, Decimal>> {
    const body = (await this.rest.request('spot', 'GET', '/api/v3/ticker/price', {}, 'none', 'safe')) as {
      symbol: string;
      price: string;
    }[];
    if (!Array.isArray(body)) throw new Error('Invalid ticker response');
    return new Map(body.map((t) => [t.symbol, dec(t.price)]));
  }

  /** B6.3 futures equity = USDⓈ-M margin balance; `available` caps new margin (B6.5). */
  async futuresAccount(): Promise<{ equity: Decimal; available: Decimal }> {
    const body = (await this.rest.request('futures', 'GET', '/fapi/v3/account', {}, 'signed', 'safe')) as {
      totalMarginBalance?: string;
      availableBalance?: string;
    };
    return { equity: dec(body.totalMarginBalance), available: dec(body.availableBalance) };
  }

  /** One-way USDⓈ-M position: signed amount (> 0 long, < 0 short, 0 flat) and prices. */
  async futuresPosition(symbol: string): Promise<{ amount: Decimal; entryPrice: Decimal; liquidationPrice: Decimal | null }> {
    const rows = (await this.rest.request('futures', 'GET', '/fapi/v3/positionRisk', { symbol }, 'signed', 'safe')) as {
      symbol: string;
      positionAmt: string;
      entryPrice: string;
      liquidationPrice: string;
    }[];
    if (!Array.isArray(rows)) throw new Error('Invalid positionRisk response');
    const row = rows.find((r) => r.symbol === symbol);
    if (!row) return { amount: new Decimal(0), entryPrice: new Decimal(0), liquidationPrice: null };
    const liq = dec(row.liquidationPrice);
    return { amount: dec(row.positionAmt), entryPrice: dec(row.entryPrice), liquidationPrice: liq.isZero() ? null : liq };
  }

  /**
   * B9.1: set the symbol's margin mode and leverage, then verify them. Also
   * requires one-way position mode (hedge mode is out of scope).
   */
  async ensureFuturesSetup(symbol: string, marginMode: 'isolated' | 'cross', leverage: number): Promise<void> {
    if (!this.tradingEnabled) throw new TradingDisabledError('change margin mode or leverage');
    const dual = (await this.rest.request('futures', 'GET', '/fapi/v1/positionSide/dual', {}, 'signed', 'safe')) as {
      dualSidePosition?: boolean;
    };
    if (dual.dualSidePosition !== false) throw new Error('USDⓈ-M account is in hedge mode; one-way mode is required');

    const marginType = marginMode === 'isolated' ? 'ISOLATED' : 'CROSSED';
    try {
      await this.rest.request('futures', 'POST', '/fapi/v1/marginType', { symbol, marginType }, 'signed', 'safe');
    } catch (err) {
      if (!(err instanceof BinanceError && err.code === MARGIN_TYPE_UNCHANGED)) throw err;
    }
    await this.rest.request('futures', 'POST', '/fapi/v1/leverage', { symbol, leverage }, 'signed', 'safe');

    const configs = (await this.rest.request('futures', 'GET', '/fapi/v1/symbolConfig', { symbol }, 'signed', 'safe')) as {
      symbol: string;
      marginType: string;
      leverage: number;
    }[];
    const cfg = Array.isArray(configs) ? configs.find((c) => c.symbol === symbol) : undefined;
    if (!cfg || cfg.marginType !== marginType || cfg.leverage !== leverage) {
      throw new Error(`${symbol} margin/leverage not applied: wanted ${marginType} ${leverage}x`);
    }
  }
}

function orderPath(ref: OrderRef, op: 'place' | 'query'): string {
  if (ref.kind === 'algo') return '/fapi/v1/algoOrder';
  if (ref.kind === 'oco') return op === 'place' ? '/api/v3/orderList/oco' : '/api/v3/orderList';
  return ref.market === 'spot' ? '/api/v3/order' : '/fapi/v1/order';
}

function idParams(ref: OrderRef, op: 'query' | 'cancel'): Params {
  if (ref.kind === 'algo') return { clientAlgoId: ref.clientId };
  if (ref.kind === 'oco') return op === 'query' ? { origClientOrderId: ref.clientId } : { symbol: ref.symbol, listClientOrderId: ref.clientId };
  return { symbol: ref.symbol, origClientOrderId: ref.clientId };
}

function parseOrder(ref: OrderRef, body: unknown): OrderState {
  const b = (body ?? {}) as Record<string, unknown>;
  if (ref.kind === 'algo') {
    return { ref, exchangeId: String(b.algoId), status: String(b.algoStatus), executedQty: new Decimal(0), avgPrice: null };
  }
  if (ref.kind === 'oco') {
    return { ref, exchangeId: String(b.orderListId), status: String(b.listOrderStatus), executedQty: new Decimal(0), avgPrice: null };
  }
  const executedQty = dec(b.executedQty);
  let avgPrice: Decimal | null = null;
  if (executedQty.gt(0)) {
    // Spot reports the quote total; USDⓈ-M reports the average (order query only, not the RESULT response).
    if (ref.market === 'spot') avgPrice = dec(b.cummulativeQuoteQty).div(executedQty);
    else if (b.avgPrice !== undefined) avgPrice = dec(b.avgPrice);
  }
  return { ref, exchangeId: String(b.orderId), status: String(b.status), executedQty, avgPrice };
}

function dec(value: unknown): Decimal {
  if (typeof value !== 'string' || value === '') throw new Error(`Invalid Binance decimal: ${JSON.stringify(value)}`);
  return new Decimal(value);
}
