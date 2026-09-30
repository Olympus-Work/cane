import type { Market } from '@cane/core';

export const EXCHANGE_READER = Symbol('EXCHANGE_READER');

/** 24h ticker for one symbol. Prices and percentages are decimal strings. */
export interface Ticker {
  price: string;
  /** 24h change in percent, e.g. "-1.25". */
  changePct: string;
}

/** A futures position as Binance reports it (one-way mode). */
export interface FuturesPositionInfo {
  pair: string;
  /** Signed: > 0 long, < 0 short. */
  amount: string;
  entryPrice: string;
  markPrice: string;
  unrealizedPnl: string;
  /** Null when Binance reports none (cross with no risk, or spot). */
  liquidationPrice: string | null;
}

export interface ExchangeSnapshot {
  spotEquity: string;
  futuresEquity: string;
  /** Keyed `<market>:<pair>`, e.g. `futures:BTCUSDT`. Holds every USDT pair Binance lists on the market. */
  tickers: Record<string, Ticker>;
  futuresPositions: FuturesPositionInfo[];
}

/** Why a read failed, so the dashboard can tell a missing key from an outage (B16.3). */
export class ExchangeReadError extends Error {
  constructor(
    readonly kind: 'no_key' | 'key_rejected' | 'unreachable',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Read-only view of Binance for the API (S09.5). Never places or cancels
 * anything. A port so API tests run on a fake (like `PERMISSION_CHECKER`).
 */
export interface ExchangeReader {
  /** Throws `ExchangeReadError`. */
  snapshot(): Promise<ExchangeSnapshot>;
  /** B10.6: a USDT pair listed and TRADING on the market. Throws `ExchangeReadError`. */
  isListed(market: Market, pair: string): Promise<boolean>;
}

export const tickerKey = (market: Market, pair: string): string => `${market}:${pair}`;
