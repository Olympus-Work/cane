import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { Decision } from '@cane/core';
import { classifyKey, describeDecision, sameDecision } from '../src/replay/diff.js';

const D1 = 1_727_740_800_000; // a 1D open time
const enter: Decision = {
  type: 'enter',
  side: 'long',
  kind: 'primary',
  signal: { timeframe: '1d', openTime: D1 },
  refPrice: new Decimal('84000'),
  stop: new Decimal('80000.5'),
  stopSource: 'trail',
  takeProfit: null,
  trend1w: 'bullish',
};
/** What `claimSignal` stores: the decision through JSON (Decimals become strings). */
const stored = (d: Decision): unknown => JSON.parse(JSON.stringify(d));

describe('replay-diff comparison (plan S13)', () => {
  it('matches a decision against its own stored JSON', () => {
    expect(sameDecision(stored(enter), enter)).toBe(true);
    const none: Decision = { type: 'none', reason: 'no_signal' };
    expect(sameDecision(stored(none), none)).toBe(true);
    const move: Decision = { type: 'move_stop', side: 'long', stop: new Decimal('81000'), signal: { timeframe: '1d', openTime: D1 } };
    expect(sameDecision(stored(move), move)).toBe(true);
    const exit: Decision = { type: 'exit', side: 'long', reason: 'first_red', signal: { timeframe: '1d', openTime: D1 }, refPrice: new Decimal('83000') };
    expect(sameDecision(stored(exit), exit)).toBe(true);
    const warm: Decision = { type: 'warming_up', timeframes: ['1w', '1d'] };
    expect(sameDecision({ type: 'warming_up', timeframes: ['1d', '1w'] }, warm)).toBe(true);
  });

  it('compares decimals by value, not by text', () => {
    expect(sameDecision({ ...(stored(enter) as object), stop: '80000.50' }, enter)).toBe(true);
    expect(sameDecision({ ...(stored(enter) as object), stop: '80000.6' }, enter)).toBe(false);
  });

  it('ignores keys annotateSignal adds later (the entry plan)', () => {
    expect(sameDecision({ ...(stored(enter) as object), plan: { qty: '0.01' }, jevCallId: 3 }, enter)).toBe(true);
  });

  it('ignores refPrice (the market fills near it) but not stop source, take-profit or 1W trend', () => {
    expect(sameDecision({ ...(stored(enter) as object), refPrice: '1' }, enter)).toBe(true);
    expect(sameDecision({ ...(stored(enter) as object), stopSource: 'atr_fallback' }, enter)).toBe(false);
    expect(sameDecision({ ...(stored(enter) as object), takeProfit: '90000' }, enter)).toBe(false);
    expect(sameDecision({ ...(stored(enter) as object), trend1w: 'bearish' }, enter)).toBe(false);
  });

  it('differs on type, side, kind, reason or signal candle', () => {
    expect(sameDecision({ type: 'none', reason: 'no_signal' }, enter)).toBe(false);
    expect(sameDecision({ ...(stored(enter) as object), side: 'short' }, enter)).toBe(false);
    expect(sameDecision({ ...(stored(enter) as object), kind: 'late' }, enter)).toBe(false);
    expect(sameDecision({ ...(stored(enter) as object), signal: { timeframe: '1d', openTime: D1 + 1 } }, enter)).toBe(false);
    expect(sameDecision({ type: 'none', reason: 'trend_filter' }, { type: 'none', reason: 'no_signal' })).toBe(false);
    expect(sameDecision(null, enter)).toBe(false);
  });

  it('classifies a key: match, differ, missing_live, missing_replay', () => {
    const gap: Decision = { type: 'none', reason: 'data_gap' };
    expect(classifyKey(1, stored(enter), enter, true)).toEqual({ key: 1, outcome: 'match' });
    expect(classifyKey(1, { type: 'none', reason: 'no_signal' }, enter, true)?.outcome).toBe('differ');
    expect(classifyKey(1, undefined, enter, true)?.outcome).toBe('missing_live');
    expect(classifyKey(1, stored(enter), gap, true)?.outcome).toBe('missing_replay');
  });

  it('skips keys live was not due to record', () => {
    const gap: Decision = { type: 'none', reason: 'data_gap' };
    // Before the strategy was enabled or after it was disabled: no live rows around.
    expect(classifyKey(1, undefined, enter, false)).toBeNull();
    // A data gap on both sides: live does not record one either (E4).
    expect(classifyKey(1, undefined, gap, true)).toBeNull();
  });

  it('describes both sides of a mismatch in one line', () => {
    const d = classifyKey(1, { type: 'none', reason: 'no_signal' }, enter, true)!;
    expect(d.live).toBe('none:no_signal');
    expect(d.replay).toBe('enter long primary 1d@2024-10-01T00:00:00.000Z stop 80000.5 tp -');
    expect(describeDecision(undefined)).toBe('none recorded');
  });
});
