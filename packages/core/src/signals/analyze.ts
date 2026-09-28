import { atr } from '../indicators/atr.js';
import { type ActionZoneBar, cdcActionZone } from '../indicators/cdc-action-zone.js';
import { cdcTrail } from '../indicators/cdc-trail.js';
import type { Candle, Series, Timeframe } from '../types.js';

/** ATR length for the "trail on the wrong side" stop fallback (B4.3, B5.2). */
export const FALLBACK_ATR_LENGTH = 10;
export const FALLBACK_ATR_MULTIPLIER = 2;

/**
 * Indicators for one timeframe. All indicators are causal (bar i depends
 * only on bars <= i), so analysing a long series and reading index i gives
 * the same values as analysing the prefix ending at i. The live engine and
 * the replay both rely on this.
 */
export interface TimeframeAnalysis {
  timeframe: Timeframe;
  candles: readonly Candle[];
  zone: ActionZoneBar[];
  trail: Series;
  atr: Series;
}

export function analyzeTimeframe(timeframe: Timeframe, candles: readonly Candle[]): TimeframeAnalysis {
  for (let i = 1; i < candles.length; i++) {
    if (candles[i]!.openTime <= candles[i - 1]!.openTime) {
      throw new Error(`${timeframe} candles must be sorted by openTime without duplicates (index ${i})`);
    }
  }
  return {
    timeframe,
    candles,
    zone: cdcActionZone(candles),
    trail: cdcTrail(candles),
    atr: atr(candles, FALLBACK_ATR_LENGTH),
  };
}

/** Index of the last candle with `closeTime < nowMs`, or -1. Binary search. */
export function lastClosedIndex(candles: readonly Candle[], nowMs: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid]!.closeTime < nowMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
