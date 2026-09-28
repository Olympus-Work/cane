import { Decimal } from 'decimal.js';
import type { Candle, Series } from '../types.js';
import { rma } from './ema.js';

/** True range; the first bar (no previous close) uses `high − low`. */
export function trueRange(candles: readonly Candle[]): Decimal[] {
  return candles.map((c, i) => {
    const hl = c.high.minus(c.low);
    if (i === 0) return hl;
    const prevClose = candles[i - 1]!.close;
    return Decimal.max(hl, c.high.minus(prevClose).abs(), c.low.minus(prevClose).abs());
  });
}

/** Wilder ATR, Pine `ta.atr` semantics: `rma(trueRange, length)`. */
export function atr(candles: readonly Candle[], length: number): Series {
  return rma(trueRange(candles), length);
}
