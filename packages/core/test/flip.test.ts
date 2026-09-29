import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import {
  decideFlip,
  presentFactorCount,
  type FlipInput,
  type JevFactor,
  type JevResult,
} from '../src/signals/flip.js';

const jev = (...conf: [number, number, number]): JevResult =>
  ({
    ok: true,
    factors: conf.map((c) => ({ present: c >= 0.5, confidence: c })) as [JevFactor, JevFactor, JevFactor],
  });

const profit = new Decimal('125.5');
const loss = new Decimal('-40');
const zero = new Decimal(0);

/** Build a futures flip input; the long->short case is the default. */
const input = (over: Partial<FlipInput> = {}): FlipInput => ({
  market: 'futures',
  closedSide: 'long',
  exitReason: 'first_red',
  realisedPnl: profit,
  jev: jev(0.9, 0.8, 0.2),
  ...over,
});

/** The two directions of the same spec case: long->short and short->long. */
const directions = [
  { name: 'long -> short', side: 'long' as const, exitReason: 'first_red' as const, flipSide: 'short' as const },
  { name: 'short -> long', side: 'short' as const, exitReason: 'first_green' as const, flipSide: 'long' as const },
];

describe('decideFlip (AC14)', () => {
  it.each(directions)(
    '$name: profitable exit + 2 of 3 opposite factors present flips',
    ({ side, exitReason, flipSide }) => {
      expect(decideFlip(input({ closedSide: side, exitReason, jev: jev(0.9, 0.8, 0.2) }))).toEqual({
        flip: true,
        side: flipSide,
        presentFactors: 2,
      });
    },
  );

  it.each(directions)(
    '$name: profitable exit + 3 factors present flips',
    ({ side, exitReason, flipSide }) => {
      expect(decideFlip(input({ closedSide: side, exitReason, jev: jev(0.9, 0.9, 0.95) }))).toEqual({
        flip: true,
        side: flipSide,
        presentFactors: 3,
      });
    },
  );

  it.each(directions)(
    '$name: only 1 factor present -> too_few_factors',
    ({ side, exitReason }) => {
      expect(decideFlip(input({ closedSide: side, exitReason, jev: jev(0.9, 0.3, 0.2) }))).toEqual({
        flip: false,
        reason: 'too_few_factors',
      });
    },
  );

  it.each(directions)(
    '$name: losing exit -> not_profitable',
    ({ side, exitReason }) => {
      expect(decideFlip(input({ closedSide: side, exitReason, realisedPnl: loss }))).toEqual({
        flip: false,
        reason: 'not_profitable',
      });
    },
  );

  it.each(directions)(
    '$name: zero PnL -> not_profitable',
    ({ side, exitReason }) => {
      expect(decideFlip(input({ closedSide: side, exitReason, realisedPnl: zero }))).toEqual({
        flip: false,
        reason: 'not_profitable',
      });
    },
  );

  it.each(directions)(
    '$name: stop exit -> not_opposite_signal',
    ({ side }) => {
      expect(decideFlip(input({ closedSide: side, exitReason: 'stop' }))).toEqual({
        flip: false,
        reason: 'not_opposite_signal',
      });
    },
  );

  it.each(directions)(
    '$name: take_profit exit -> not_opposite_signal',
    ({ side }) => {
      expect(decideFlip(input({ closedSide: side, exitReason: 'take_profit' }))).toEqual({
        flip: false,
        reason: 'not_opposite_signal',
      });
    },
  );

  it('long closed by first_green (wrong signal for a long) -> not_opposite_signal', () => {
    expect(decideFlip(input({ closedSide: 'long', exitReason: 'first_green' }))).toEqual({
      flip: false,
      reason: 'not_opposite_signal',
    });
  });

  it.each(directions)(
    '$name: spot market -> spot, even with 3 factors and profit',
    ({ side, exitReason }) => {
      expect(decideFlip(input({ closedSide: side, exitReason, market: 'spot', jev: jev(0.9, 0.9, 0.95) }))).toEqual({
        flip: false,
        reason: 'spot',
      });
    },
  );

  it.each(['timeout', 'error', 'invalid_response'] as const)(
    '%s: Jev failure -> jev_failed',
    (reason) => {
      expect(decideFlip(input({ jev: { ok: false, reason } }))).toEqual({ flip: false, reason: 'jev_failed' });
    },
  );

  describe('confidence threshold', () => {
    it('factors present with confidence 0.69 do not count at the default 0.70 -> too_few_factors', () => {
      const factors: [JevFactor, JevFactor, JevFactor] = [
        { present: true, confidence: 0.69 },
        { present: true, confidence: 0.69 },
        { present: true, confidence: 0.69 },
      ];
      expect(decideFlip(input({ jev: { ok: true, factors } }))).toEqual({ flip: false, reason: 'too_few_factors' });
    });

    it('confidence exactly 0.70 counts at the default threshold', () => {
      const factors: [JevFactor, JevFactor, JevFactor] = [
        { present: true, confidence: 0.7 },
        { present: true, confidence: 0.7 },
        { present: true, confidence: 0.7 },
      ];
      expect(decideFlip(input({ jev: { ok: true, factors } }))).toEqual({
        flip: true,
        side: 'short',
        presentFactors: 3,
      });
    });

    it('input threshold 0.6: confidences 0.65, 0.65, 0.1 -> flip true', () => {
      const factors: [JevFactor, JevFactor, JevFactor] = [
        { present: true, confidence: 0.65 },
        { present: true, confidence: 0.65 },
        { present: true, confidence: 0.1 },
      ];
      expect(decideFlip(input({ jev: { ok: true, factors }, threshold: 0.6 }))).toEqual({
        flip: true,
        side: 'short',
        presentFactors: 2,
      });
    });
  });

  it('a factor with present:false but confidence 0.99 does not count', () => {
    const factors: [JevFactor, JevFactor, JevFactor] = [
      { present: false, confidence: 0.99 },
      { present: true, confidence: 0.9 },
      { present: true, confidence: 0.9 },
    ];
    expect(decideFlip(input({ jev: { ok: true, factors } }))).toEqual({
      flip: true,
      side: 'short',
      presentFactors: 2,
    });
  });

  it('the decision never mentions the 1W trend: a flip result has exactly flip, side, presentFactors', () => {
    const decision = decideFlip(input({ jev: jev(0.9, 0.9, 0.95) }));
    expect(decision).toEqual({ flip: true, side: 'short', presentFactors: 3 });
    expect(Object.keys(decision).sort()).toEqual(['flip', 'presentFactors', 'side']);
  });
});

describe('presentFactorCount', () => {
  it('a Jev failure counts as 0', () => {
    expect(presentFactorCount({ ok: false, reason: 'timeout' })).toBe(0);
    expect(presentFactorCount({ ok: false, reason: 'error' })).toBe(0);
    expect(presentFactorCount({ ok: false, reason: 'invalid_response' })).toBe(0);
  });

  it('mixed factors -> correct count at the default threshold', () => {
    // 0.9 present, 0.8 present, 0.2 not present -> 2
    expect(presentFactorCount(jev(0.9, 0.8, 0.2))).toBe(2);
    // 0.69 present but below threshold, 0.7 present, 0.3 not present -> 1
    const factors: [JevFactor, JevFactor, JevFactor] = [
      { present: true, confidence: 0.69 },
      { present: true, confidence: 0.7 },
      { present: false, confidence: 0.3 },
    ];
    expect(presentFactorCount({ ok: true, factors })).toBe(1);
    // same, at threshold 0.6 -> 2
    expect(presentFactorCount({ ok: true, factors }, 0.6)).toBe(2);
  });
});
