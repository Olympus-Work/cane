import { type Decimal } from 'decimal.js';
import type { Candle, Regime } from '../types.js';
import { ema } from './ema.js';

export interface ActionZoneBar {
  fast: Decimal | null;
  slow: Decimal | null;
  bull: boolean;
  bear: boolean;
  green: boolean;
  red: boolean;
  buyCond: boolean;
  sellCond: boolean;
  /** Regime after this bar; `null` until at least one buyCond and one sellCond exist (Pine `barssince` = na). */
  regime: Regime;
  /** buyCond on a bar whose previous bar's regime was bearish. */
  firstGreen: boolean;
  /** sellCond on a bar whose previous bar's regime was bullish. */
  firstRed: boolean;
}

export interface ActionZoneParams {
  fastLength: number;
  slowLength: number;
}

export const DEFAULT_ACTION_ZONE: ActionZoneParams = { fastLength: 12, slowLength: 26 };

/**
 * CDC Action Zone on close, no smoothing (spec Definitions).
 * Bars where an EMA is not available have all flags false.
 */
export function cdcActionZone(candles: readonly Candle[], params: ActionZoneParams = DEFAULT_ACTION_ZONE): ActionZoneBar[] {
  const closes = candles.map((c) => c.close);
  const fastSeries = ema(closes, params.fastLength);
  const slowSeries = ema(closes, params.slowLength);
  const out: ActionZoneBar[] = [];
  let lastBuy = -1;
  let lastSell = -1;
  for (let i = 0; i < candles.length; i++) {
    const close = closes[i]!;
    const fast = fastSeries[i] ?? null;
    const slow = slowSeries[i] ?? null;
    const defined = fast !== null && slow !== null;
    const bull = defined && fast.gt(slow);
    const bear = defined && fast.lt(slow);
    const green = bull && close.gt(fast!);
    const red = bear && close.lt(fast!);
    const prev = out[i - 1];
    const buyCond = green && !(prev?.green ?? false);
    const sellCond = red && !(prev?.red ?? false);
    if (buyCond) lastBuy = i;
    if (sellCond) lastSell = i;
    const regime: Regime = lastBuy < 0 || lastSell < 0 ? null : lastBuy > lastSell ? 'bullish' : 'bearish';
    const prevRegime = prev?.regime ?? null;
    out.push({
      fast,
      slow,
      bull,
      bear,
      green,
      red,
      buyCond,
      sellCond,
      regime,
      firstGreen: buyCond && prevRegime === 'bearish',
      firstRed: sellCond && prevRegime === 'bullish',
    });
  }
  return out;
}
