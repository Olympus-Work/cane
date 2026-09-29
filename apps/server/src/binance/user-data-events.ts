import { Decimal } from 'decimal.js';
import type { BinanceMarket } from './endpoints.js';

export interface OrderEvent {
  kind: 'order';
  market: BinanceMarket;
  symbol: string; // spot `s`, futures `o.s`
  clientId: string; // spot `c`, futures `o.c`
  exchangeId: string; // String(spot `i` / futures `o.i`)
  side: 'BUY' | 'SELL'; // `S` / `o.S`
  orderType: string; // `o` / `o.o`
  status: string; // `X` / `o.X`
  executedQty: Decimal; // cumulative filled: `z` / `o.z`
  lastFillQty: Decimal; // `l` / `o.l`
  lastFillPrice: Decimal; // `L` / `o.L`
  fee: { asset: string; amount: Decimal } | null; // `N` + `n` (futures `o.N` + `o.n`); null when the asset is null/empty or the amount is zero
  realizedPnl: Decimal | null; // futures `o.rp`; always null for spot
  eventTime: number; // `E`
}

export interface AlgoEvent {
  kind: 'algo';
  market: 'futures';
  symbol: string; // `o.s`
  clientId: string; // `o.caid`
  exchangeId: string; // String(`o.aid`)
  orderType: string; // `o.o`
  status: string; // `o.X`
  triggerPrice: Decimal; // `o.tp`
  eventTime: number; // `E`
}

export interface ListEvent {
  kind: 'list';
  market: 'spot';
  symbol: string; // `s`
  clientId: string; // `C` (listClientOrderId)
  exchangeId: string; // String(`g`)
  status: string; // `L` (listOrderStatus, e.g. EXECUTING / ALL_DONE)
  legClientIds: string[]; // `O[].c`
  eventTime: number; // `E`
}

export type UserDataEvent = OrderEvent | AlgoEvent | ListEvent;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read a required string field. */
function stringField(obj: Record<string, unknown>, name: string, eventType: string): string {
  const value = obj[name];
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${eventType} field ${name}`);
  }
  return value;
}

/** Read a required finite JSON number field. */
function numberField(obj: Record<string, unknown>, name: string, eventType: string): number {
  const value = obj[name];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${eventType} field ${name}`);
  }
  return value;
}

/** Read a required decimal string field, e.g. "0.00020000". */
function decimalField(obj: Record<string, unknown>, name: string, eventType: string): Decimal {
  const raw = stringField(obj, name, eventType);
  let value: Decimal;
  try {
    value = new Decimal(raw);
  } catch {
    throw new Error(`Invalid ${eventType} field ${name}`);
  }
  if (!value.isFinite()) {
    throw new Error(`Invalid ${eventType} field ${name}`);
  }
  return value;
}

/** Read a required order side. */
function sideField(obj: Record<string, unknown>, name: string, eventType: string): 'BUY' | 'SELL' {
  const value = stringField(obj, name, eventType);
  if (value !== 'BUY' && value !== 'SELL') {
    throw new Error(`Invalid ${eventType} field ${name}`);
  }
  return value;
}

/**
 * Read the fee from `assetField` + `amountField`. Null when the asset is
 * null/empty or the amount is zero.
 */
function feeField(
  obj: Record<string, unknown>,
  assetField: string,
  amountField: string,
  eventType: string,
): { asset: string; amount: Decimal } | null {
  const asset = obj[assetField];
  const amount = decimalField(obj, amountField, eventType);
  if (typeof asset !== 'string' || asset === '' || amount.isZero()) {
    return null;
  }
  return { asset, amount };
}

/** Parse a spot or futures execution report from a flat event object. */
function parseOrderEvent(
  event: Record<string, unknown>,
  market: BinanceMarket,
  eventType: string,
  eventTime: number,
): OrderEvent {
  return {
    kind: 'order',
    market,
    symbol: stringField(event, 's', eventType),
    clientId: stringField(event, 'c', eventType),
    exchangeId: String(numberField(event, 'i', eventType)),
    side: sideField(event, 'S', eventType),
    orderType: stringField(event, 'o', eventType),
    status: stringField(event, 'X', eventType),
    executedQty: decimalField(event, 'z', eventType),
    lastFillQty: decimalField(event, 'l', eventType),
    lastFillPrice: decimalField(event, 'L', eventType),
    fee: feeField(event, 'N', 'n', eventType),
    realizedPnl: market === 'futures' ? decimalField(event, 'rp', eventType) : null,
    eventTime,
  };
}

/** Parse a spot listStatus event (OCO list state). */
function parseListEvent(event: Record<string, unknown>): ListEvent {
  const legs = event.O;
  if (!Array.isArray(legs)) {
    throw new Error('Invalid listStatus field O');
  }
  const legClientIds = legs.map((leg) => {
    if (!isRecord(leg) || typeof leg.c !== 'string') {
      throw new Error('Invalid listStatus field O[].c');
    }
    return leg.c;
  });
  return {
    kind: 'list',
    market: 'spot',
    symbol: stringField(event, 's', 'listStatus'),
    clientId: stringField(event, 'C', 'listStatus'),
    exchangeId: String(numberField(event, 'g', 'listStatus')),
    status: stringField(event, 'L', 'listStatus'),
    legClientIds,
    eventTime: numberField(event, 'E', 'listStatus'),
  };
}

/** Parse a futures ALGO_UPDATE event (Algo Order API state). */
function parseAlgoEvent(msg: Record<string, unknown>): AlgoEvent {
  const o = msg.o;
  if (!isRecord(o)) {
    throw new Error('Invalid ALGO_UPDATE field o');
  }
  return {
    kind: 'algo',
    market: 'futures',
    symbol: stringField(o, 's', 'ALGO_UPDATE'),
    clientId: stringField(o, 'caid', 'ALGO_UPDATE'),
    exchangeId: String(numberField(o, 'aid', 'ALGO_UPDATE')),
    orderType: stringField(o, 'o', 'ALGO_UPDATE'),
    status: stringField(o, 'X', 'ALGO_UPDATE'),
    triggerPrice: decimalField(o, 'tp', 'ALGO_UPDATE'),
    eventTime: numberField(msg, 'E', 'ALGO_UPDATE'),
  };
}

/**
 * One raw USDⓈ-M stream message → event; 'listen_key_expired' for
 * e === 'listenKeyExpired'; null for any other event type (ACCOUNT_UPDATE,
 * TRADE_LITE, MARGIN_CALL, ...).
 */
export function parseFuturesEvent(
  msg: unknown,
): UserDataEvent | 'listen_key_expired' | null {
  if (!isRecord(msg) || typeof msg.e !== 'string') {
    return null;
  }
  switch (msg.e) {
    case 'listenKeyExpired':
      return 'listen_key_expired';
    case 'ORDER_TRADE_UPDATE': {
      const o = msg.o;
      if (!isRecord(o)) {
        throw new Error('Invalid ORDER_TRADE_UPDATE field o');
      }
      return parseOrderEvent(
        o,
        'futures',
        'ORDER_TRADE_UPDATE',
        numberField(msg, 'E', 'ORDER_TRADE_UPDATE'),
      );
    }
    case 'ALGO_UPDATE':
      return parseAlgoEvent(msg);
    default:
      return null;
  }
}

/**
 * One spot WebSocket-API frame → event. Frames without an `event` object
 * (request responses) → null. `event.e` 'executionReport' → OrderEvent
 * (market 'spot'); 'listStatus' → ListEvent; 'eventStreamTerminated' →
 * 'stream_terminated'; anything else (outboundAccountPosition, balanceUpdate,
 * ...) → null.
 */
export function parseSpotEvent(msg: unknown): UserDataEvent | 'stream_terminated' | null {
  if (!isRecord(msg) || !isRecord(msg.event)) {
    return null;
  }
  const event = msg.event;
  if (typeof event.e !== 'string') {
    return null;
  }
  switch (event.e) {
    case 'executionReport':
      return parseOrderEvent(
        event,
        'spot',
        'executionReport',
        numberField(event, 'E', 'executionReport'),
      );
    case 'listStatus':
      return parseListEvent(event);
    case 'eventStreamTerminated':
      return 'stream_terminated';
    default:
      return null;
  }
}
