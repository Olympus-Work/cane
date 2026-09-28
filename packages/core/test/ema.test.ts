import { describe, expect, it } from 'vitest';
import { ema, rma } from '../src/indicators/ema.js';
import { d, str } from './helpers.js';

describe('ema (Pine ta.ema: SMA seed, alpha = 2/(n+1))', () => {
  it('seeds with the SMA of the first n values, then recurses', () => {
    // n=3, alpha=0.5: seed (1+2+3)/3 = 2; 0.5*4+0.5*2 = 3; 0.5*5+0.5*3 = 4
    expect(str(ema([1, 2, 3, 4, 5].map(d), 3))).toEqual([null, null, '2', '3', '4']);
  });

  it('uses alpha = 2/(n+1) for n=7 (alpha 0.25)', () => {
    // seed = 10; 0.25*14 + 0.75*10 = 11
    expect(str(ema([10, 10, 10, 10, 10, 10, 10, 14].map(d), 7)).slice(6)).toEqual(['10', '11']);
  });

  it('is not available (null, never 0) until n values exist', () => {
    expect(str(ema([1, 2].map(d), 3))).toEqual([null, null]);
  });

  it('rejects a non-positive length', () => {
    expect(() => ema([d(1)], 0)).toThrow();
  });
});

describe('rma (Pine ta.rma: SMA seed, alpha = 1/n)', () => {
  it('seeds with the SMA, then alpha = 1/n', () => {
    // n=2: seed (2+4)/2 = 3; 0.5*6 + 0.5*3 = 4.5
    expect(str(rma([2, 4, 6].map(d), 2))).toEqual([null, '3', '4.5']);
  });
});
