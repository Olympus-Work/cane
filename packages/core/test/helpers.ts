import { Decimal } from 'decimal.js';
import type { Candle, Series, Timeframe } from '../src/types.js';
import { TIMEFRAME_MS } from '../src/types.js';

export const d = (v: number | string): Decimal => new Decimal(v);

/** Candle with explicit OHLC; times follow Binance (`closeTime = openTime + dur - 1`). */
export function candle(
  index: number,
  ohlc: { o?: number | string; h: number | string; l: number | string; c: number | string },
  tf: Timeframe = '1d',
  start = 0,
): Candle {
  const dur = TIMEFRAME_MS[tf];
  const openTime = start + index * dur;
  return {
    openTime,
    closeTime: openTime + dur - 1,
    open: d(ohlc.o ?? ohlc.c),
    high: d(ohlc.h),
    low: d(ohlc.l),
    close: d(ohlc.c),
    volume: d(1),
  };
}

/** Candles from closes only (high = low = open = close). */
export function fromCloses(closes: readonly (number | string)[], tf: Timeframe = '1d', start = 0): Candle[] {
  return closes.map((c, i) => candle(i, { h: c, l: c, c }, tf, start));
}

/** Series -> strings (null kept) for exact comparison. */
export function str(series: Series): (string | null)[] {
  return series.map((v) => (v === null ? null : v.toString()));
}
