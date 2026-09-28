import { describe, expect, it } from 'vitest';
import { cdcTrail, DEFAULT_TRAIL } from '../src/indicators/cdc-trail.js';
import { candle, fromCloses, str } from './helpers.js';

// k = 1, n = 1 so ATR(1) = true range and every value can be checked by hand.
const P = { multiplier: 1, length: 1 };

// prettier-ignore
const bars = [
  candle(0, { h: 11, l: 9, c: 10 }),     // TR 2. t=nz(na)=0, no prev close -> otherwise: 10 > 0 -> 10-2 = 8
  candle(1, { h: 12, l: 10, c: 11 }),    // TR 2. 11>8 and 10>8 -> max(8, 11-2=9) = 9           (branch 1)
  candle(2, { h: 11.5, l: 10.5, c: 11 }),// TR 1. 11>9 and 11>9 -> max(9, 10) = 10               (branch 1)
  candle(3, { h: 11, l: 7, c: 8 }),      // TR 4. 8<10 but prev 11>10 -> otherwise: 8+4 = 12     (branch 3, below)
  candle(4, { h: 9, l: 7, c: 8 }),       // TR 2. 8<12 and 8<12 -> min(12, 10) = 10              (branch 2)
  candle(5, { h: 9, l: 8, c: 9 }),       // TR 1. 9<10 and 8<10 -> min(10, 10) = 10              (branch 2)
  candle(6, { h: 13, l: 9, c: 12 }),     // TR 4. 12>10 but prev 9<10 -> otherwise: 12-4 = 8     (branch 3, above)
  candle(7, { h: 12.5, l: 11, c: 11 }),  // TR 1.5. 11>8 and 12>8 -> max(8, 9.5) = 9.5            (branch 1)
  candle(8, { h: 12, l: 6, c: 10 }),     // TR 6. 10>9.5 and 11>9.5 -> max(9.5, 4) = 9.5 (keeps t)
  candle(9, { h: 13, l: 9, c: 9 }),      // TR 4. 9<9.5, prev 10>9.5 -> otherwise: 9+4 = 13
  candle(10, { h: 14, l: 10, c: 14 }),   // TR 5. 14>13 but prev 9<13 -> otherwise: 14-5 = 9
  candle(11, { h: 10, l: 5, c: 6 }),     // TR 9. 6<9, prev 14>9 -> otherwise: 6+9 = 15
  candle(12, { h: 7, l: 5, c: 7 }),      // TR 2. 7<15 and 6<15 -> min(15, 9) = 9 (tightens)
  candle(13, { h: 8, l: 6, c: 6 }),      // TR 2. 6<9 and 7<9 -> min(9, 8) = 8
  candle(14, { h: 9, l: 6, c: 6 }),      // TR 3. 6<8 and 6<8 -> min(8, 9) = 8 (keeps t)
];

describe('cdcTrail (spec Definitions, slow trail)', () => {
  it('reproduces all three branches exactly', () => {
    expect(str(cdcTrail(bars, P))).toEqual([
      '8', '9', '10', '12', '10', '10', '8', '9.5', '9.5', '13', '9', '15', '9', '8', '8',
    ]);
  });

  it('long-side trail never moves down while price stays above it', () => {
    const t = cdcTrail(bars, P);
    expect(t[8]!.gte(t[7]!)).toBe(true);
  });

  it('short-side trail never moves up while price stays below it', () => {
    const t = cdcTrail(bars, P);
    expect(t[14]!.lte(t[13]!)).toBe(true);
  });

  it('defaults to k=2, n=10 and is null until ATR(10) exists', () => {
    expect(DEFAULT_TRAIL).toEqual({ multiplier: 2, length: 10 });
    const flat = fromCloses(Array.from({ length: 12 }, () => 100));
    const t = str(cdcTrail(flat));
    expect(t.slice(0, 9)).toEqual(Array(9).fill(null));
    // flat closes: TR = 0, ATR = 0 -> first defined bar: 100 > 0 -> 100 - 0; then 100 is not > 100 -> otherwise branch
    expect(t[9]).toBe('100');
  });
});
