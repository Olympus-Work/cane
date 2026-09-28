import { Decimal } from 'decimal.js';
import type { Candle, Series } from '../types.js';
import { atr } from './atr.js';

export interface TrailParams {
  /** ATR multiplier `k`. */
  multiplier: number;
  /** ATR length `n`. */
  length: number;
}

/** Slow trail of the CDC ATR Trailing Stop (spec Definitions). */
export const DEFAULT_TRAIL: TrailParams = { multiplier: 2, length: 10 };

/**
 * CDC ATR trailing stop on close. With `t` = previous trail (Pine `nz(t, 0)`):
 * - close > t and close[prev] > t → max(t, close − k·ATR)
 * - close < t and close[prev] < t → min(t, close + k·ATR)
 * - otherwise → close − k·ATR if close > t, else close + k·ATR
 * The trail is `null` where ATR is not available.
 */
export function cdcTrail(candles: readonly Candle[], params: TrailParams = DEFAULT_TRAIL): Series {
  const atrSeries = atr(candles, params.length);
  const k = new Decimal(params.multiplier);
  const out: Series = new Array<Decimal | null>(candles.length).fill(null);
  for (let i = 0; i < candles.length; i++) {
    const a = atrSeries[i];
    if (a === null || a === undefined) continue;
    const sl = k.times(a);
    const t = out[i - 1] ?? new Decimal(0);
    const close = candles[i]!.close;
    const prevClose = i > 0 ? candles[i - 1]!.close : null;
    if (prevClose !== null && close.gt(t) && prevClose.gt(t)) {
      out[i] = Decimal.max(t, close.minus(sl));
    } else if (prevClose !== null && close.lt(t) && prevClose.lt(t)) {
      out[i] = Decimal.min(t, close.plus(sl));
    } else {
      out[i] = close.gt(t) ? close.minus(sl) : close.plus(sl);
    }
  }
  return out;
}
