import { describe, expect, it } from 'vitest';
import { atr, trueRange } from '../src/indicators/atr.js';
import { candle, str } from './helpers.js';

const candles = [
  candle(0, { h: 10, l: 8, c: 9 }), // TR = high - low = 2 (no previous close)
  candle(1, { h: 12, l: 11, c: 11.5 }), // max(1, |12-9|=3, |11-9|=2) = 3
  candle(2, { h: 10, l: 9, c: 9.5 }), // max(1, |10-11.5|=1.5, |9-11.5|=2.5) = 2.5
];

describe('trueRange', () => {
  it('uses max(high-low, |high-prevClose|, |low-prevClose|), first bar high-low', () => {
    expect(trueRange(candles).map((v) => v.toString())).toEqual(['2', '3', '2.5']);
  });
});

describe('atr (Wilder: rma of true range)', () => {
  it('seeds with the SMA of the first n TR values', () => {
    // n=2: seed (2+3)/2 = 2.5; 0.5*2.5 + 0.5*2.5 = 2.5
    expect(str(atr(candles, 2))).toEqual([null, '2.5', '2.5']);
  });

  it('ATR(1) equals the true range', () => {
    expect(str(atr(candles, 1))).toEqual(['2', '3', '2.5']);
  });
});
