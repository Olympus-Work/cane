import { describe, expect, it } from 'vitest';
import { cdcActionZone, DEFAULT_ACTION_ZONE } from '../src/indicators/cdc-action-zone.js';
import { fromCloses } from './helpers.js';

// fast = EMA(3) (alpha 0.5), slow = EMA(7) (alpha 0.25): every value is an exact binary fraction.
const P = { fastLength: 3, slowLength: 7 };
// prettier-ignore
const closes = [10, 10, 10, 10, 10, 10, 10, 14, 6, 6, 14, 14, 12, 15, 8];
const bars = cdcActionZone(fromCloses(closes), P);
const idx = (pred: (i: number) => boolean) => bars.map((_, i) => i).filter(pred);

describe('cdcActionZone (spec Definitions)', () => {
  it('computes fast / slow EMA with SMA seed', () => {
    expect(bars.map((b) => b.fast?.toString() ?? null)).toEqual([
      null, null, '10', '10', '10', '10', '10', '12', '9', '7.5', '10.75', '12.375', '12.1875', '13.59375', '10.796875',
    ]);
    expect(bars.map((b) => b.slow?.toString() ?? null)).toEqual([
      null, null, null, null, null, null, '10', '11', '9.75', '8.8125', '10.109375', '11.08203125',
      '11.3115234375', '12.233642578125', '11.17523193359375',
    ]);
  });

  it('Bull/Bear need fast != slow; Green = Bull and close > fast; Red = Bear and close < fast', () => {
    expect(bars[6]!.bull || bars[6]!.bear).toBe(false); // fast == slow
    expect(idx((i) => bars[i]!.green)).toEqual([7, 10, 11, 13]);
    expect(idx((i) => bars[i]!.red)).toEqual([8, 9, 14]);
    // bar 12: Bull but close 12 < fast 12.1875 -> neither green nor red
    expect(bars[12]!.bull && !bars[12]!.green && !bars[12]!.red).toBe(true);
  });

  it('buyCond / sellCond fire only on the first bar of a green / red run', () => {
    expect(idx((i) => bars[i]!.buyCond)).toEqual([7, 10, 13]);
    expect(idx((i) => bars[i]!.sellCond)).toEqual([8, 14]);
  });

  it('regime follows the most recent buyCond vs sellCond (null until both exist)', () => {
    expect(bars.map((b) => b.regime)).toEqual([
      null, null, null, null, null, null, null, null,
      'bearish', 'bearish', 'bullish', 'bullish', 'bullish', 'bullish', 'bearish',
    ]);
  });

  it('first green / first red require the opposite regime on the previous bar', () => {
    // bar 7: buyCond but previous regime null -> not first green
    // bar 8: sellCond but previous regime null -> not first red
    // bar 13: buyCond while already bullish -> not first green
    expect(idx((i) => bars[i]!.firstGreen)).toEqual([10]);
    expect(idx((i) => bars[i]!.firstRed)).toEqual([14]);
  });

  it('defaults to EMA 12 / 26', () => {
    expect(DEFAULT_ACTION_ZONE).toEqual({ fastLength: 12, slowLength: 26 });
  });

  it('is causal: a prefix gives the same bars', () => {
    const prefix = cdcActionZone(fromCloses(closes.slice(0, 11)), P);
    expect(prefix).toEqual(bars.slice(0, 11));
  });
});
