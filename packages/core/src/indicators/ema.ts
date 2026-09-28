import { Decimal } from 'decimal.js';
import type { Series } from '../types.js';

function smaSeededRecursive(values: readonly Decimal[], length: number, alpha: Decimal): Series {
  if (!Number.isInteger(length) || length < 1) throw new Error(`length must be a positive integer, got ${length}`);
  const out: Series = new Array<Decimal | null>(values.length).fill(null);
  if (values.length < length) return out;
  let seed = new Decimal(0);
  for (let i = 0; i < length; i++) seed = seed.plus(values[i]!);
  let prev = seed.div(length);
  out[length - 1] = prev;
  const keep = new Decimal(1).minus(alpha);
  for (let i = length; i < values.length; i++) {
    prev = alpha.times(values[i]!).plus(keep.times(prev));
    out[i] = prev;
  }
  return out;
}

/**
 * Exponential moving average, Pine `ta.ema` semantics:
 * first value (index length-1) = SMA of the first `length` values,
 * then `ema = α·x + (1−α)·ema[prev]` with `α = 2/(length+1)`.
 */
export function ema(values: readonly Decimal[], length: number): Series {
  return smaSeededRecursive(values, length, new Decimal(2).div(length + 1));
}

/**
 * Wilder moving average, Pine `ta.rma` semantics:
 * first value = SMA of the first `length` values, then `α = 1/length`.
 */
export function rma(values: readonly Decimal[], length: number): Series {
  return smaSeededRecursive(values, length, new Decimal(1).div(length));
}
