import { Decimal } from 'decimal.js';

export type Timeframe = '4h' | '1d' | '1w';

export const TIMEFRAMES: readonly Timeframe[] = ['4h', '1d', '1w'];

/** Candle duration in milliseconds (Binance kline intervals). */
export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
};

/**
 * One kline. Times are UTC epoch milliseconds as reported by Binance
 * (`closeTime = openTime + duration - 1`). Prices and volume are decimals.
 */
export interface Candle {
  openTime: number;
  closeTime: number;
  open: Decimal;
  high: Decimal;
  low: Decimal;
  close: Decimal;
  volume: Decimal;
}

/** A value that is not available yet (series still warming up) is `null`, never 0. */
export type Series = (Decimal | null)[];

export type Regime = 'bullish' | 'bearish' | null;

export type Market = 'spot' | 'futures';

export type Side = 'long' | 'short';
