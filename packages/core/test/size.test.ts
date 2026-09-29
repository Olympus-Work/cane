import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { LeverageBracket } from '../src/risk/leverage.js';
import { planEntry, roundDownToStep, roundToTick, sizePct, type EntryPlanInput, type SizingMode } from '../src/sizing/size.js';

const d = (v: number | string) => new Decimal(v);
const BRACKETS: LeverageBracket[] = [
  { notionalFloor: d(0), notionalCap: d('1e15'), maintMarginRatio: d('0.004'), cum: d(0), maxLeverage: 125 },
];
const FILTERS = { stepSize: d('0.001'), tickSize: d('0.01'), minQty: d('0.001'), minNotional: d(5) };

function input(over: Partial<EntryPlanInput> = {}): EntryPlanInput {
  return {
    market: 'futures',
    side: 'long',
    mode: 'B',
    basePct: d(10),
    presentFactors: 0,
    riskPct: d(2),
    leverageCeiling: 5,
    equity: d(10_000),
    freeBalance: d(1_000_000_000),
    entryPrice: d(100),
    stop: d(96), // R = 4 (4%)
    takeProfit: null,
    filters: FILTERS,
    brackets: BRACKETS,
    ...over,
  };
}

function order(over: Partial<EntryPlanInput> = {}) {
  const plan = planEntry(input(over));
  if (plan.type !== 'order') throw new Error(`expected order, got skip ${plan.reason}`);
  return plan;
}

describe('B6.2 size_pct', () => {
  it('base + 20 per present factor', () => {
    expect([0, 1, 2, 3].map((n) => sizePct(d(10), n).toString())).toEqual(['10', '30', '50', '70']);
    expect(sizePct(d(5), 3).toString()).toBe('65');
    expect(sizePct(d(20), 3).toString()).toBe('80');
  });

  it('rejects base outside 5-20 and factor counts outside 0-3', () => {
    expect(() => sizePct(d(4), 0)).toThrow();
    expect(() => sizePct(d(21), 0)).toThrow();
    expect(() => sizePct(d(10), 4)).toThrow();
  });
});

// AC7: equity 10,000, entry 100, stop 96 (R = 4), base 10, risk 2%.
// size% = 10 / 30 / 50 / 70 for 0-3 factors.
// B: notional = size% x equity                  -> 1000 / 3000 / 5000 / 7000, margin = notional / lev
// A: margin   = size% x equity                  -> 1000 / 3000 / 5000 / 7000, notional = margin x lev
// C: notional = (2% x size%/100 x equity) / R x entry -> 500 / 1500 / 2500 / 3500, margin = notional / lev
// prettier-ignore
const TABLE: [SizingMode, number, number, string, string][] = [
  ['B', 0, 1, '1000', '1000'], ['B', 1, 1, '3000', '3000'], ['B', 2, 1, '5000', '5000'], ['B', 3, 1, '7000', '7000'],
  ['B', 0, 5, '1000', '200'],  ['B', 1, 5, '3000', '600'],  ['B', 2, 5, '5000', '1000'], ['B', 3, 5, '7000', '1400'],
  ['A', 0, 1, '1000', '1000'], ['A', 1, 1, '3000', '3000'], ['A', 2, 1, '5000', '5000'], ['A', 3, 1, '7000', '7000'],
  ['A', 0, 5, '5000', '1000'], ['A', 1, 5, '15000', '3000'], ['A', 2, 5, '25000', '5000'], ['A', 3, 5, '35000', '7000'],
  ['C', 0, 1, '500', '500'],   ['C', 1, 1, '1500', '1500'], ['C', 2, 1, '2500', '2500'], ['C', 3, 1, '3500', '3500'],
  ['C', 0, 5, '500', '100'],   ['C', 1, 5, '1500', '300'],  ['C', 2, 5, '2500', '500'],  ['C', 3, 5, '3500', '700'],
];

describe('AC7 sizing table: modes A/B/C x 0-3 factors x leverage 1/5', () => {
  it.each(TABLE)('mode %s, %i factors, %ix -> notional %s, margin %s', (mode, factors, lev, notional, margin) => {
    const plan = order({ mode, presentFactors: factors, leverageCeiling: lev });
    expect(plan.notional.toString()).toBe(notional);
    expect(plan.margin.toString()).toBe(margin);
    expect(plan.quantity.toString()).toBe(d(notional).div(100).toString());
    expect(plan.leverage).toBe(lev);
    expect(plan.events).toEqual([]);
  });

  it('mode C: risk at the stop equals effective risk x equity', () => {
    // 2 factors: effective risk = 2% x 50 / 100 = 1% -> 100 USDT lost at the stop
    const plan = order({ mode: 'C', presentFactors: 2 });
    expect(plan.quantity.times(d(100).minus(96)).toString()).toBe('100');
  });

  it('spot: mode B semantics at 1x regardless of the configured mode/leverage', () => {
    const plan = order({ market: 'spot', mode: 'A', leverageCeiling: 5, equity: d('4120.55') });
    // 10% of 4120.55 = 412.055 -> qty 4.12055 -> rounded down to 4.120
    expect(plan.quantity.toString()).toBe('4.12');
    expect(plan.notional.toString()).toBe('412');
    expect(plan.leverage).toBe(1);
    expect(plan.liquidationPrice).toBeNull();
  });
});

describe('B6.5 free balance cap', () => {
  it('futures: margin above free balance -> reduced to free x leverage, sizing_reduced', () => {
    // mode B, 3 factors, 5x: margin 1400 > free 1000 -> notional 5000
    const plan = order({ presentFactors: 3, freeBalance: d(1000) });
    expect(plan.notional.toString()).toBe('5000');
    expect(plan.margin.toString()).toBe('1000');
    expect(plan.events).toEqual(['sizing_reduced']);
  });

  it('spot: notional above free quote balance -> reduced to the free balance', () => {
    const plan = order({ market: 'spot', freeBalance: d(300) });
    expect(plan.notional.toString()).toBe('300');
    expect(plan.events).toEqual(['sizing_reduced']);
  });

  it('rounding never exceeds the free balance', () => {
    const plan = order({ presentFactors: 3, freeBalance: d('999.9999'), entryPrice: d('123.45'), stop: d('118.5') });
    expect(plan.margin.lte(d('999.9999'))).toBe(true);
  });
});

describe('B6.6 rounding and minimums', () => {
  it('quantity rounds down to the step', () => {
    expect(roundDownToStep(d('1.23456'), d('0.001')).toString()).toBe('1.234');
    expect(roundDownToStep(d('0.0009'), d('0.001')).toString()).toBe('0');
    expect(roundDownToStep(d('17'), d('5')).toString()).toBe('15');
  });

  it('prices round to the tick in the given direction', () => {
    expect(roundToTick(d('95.999'), d('0.01'), 'down').toString()).toBe('95.99');
    expect(roundToTick(d('104.001'), d('0.01'), 'up').toString()).toBe('104.01');
    expect(roundToTick(d('104'), d('0.01'), 'up').toString()).toBe('104');
  });

  it('stop rounds away from price, take-profit towards it', () => {
    const long = order({ stop: d('95.999'), takeProfit: d('108.005') });
    expect([long.stop.toString(), long.takeProfit!.toString()]).toEqual(['95.99', '108']);
    const short = order({ side: 'short', stop: d('104.001'), takeProfit: d('91.995') });
    expect([short.stop.toString(), short.takeProfit!.toString()]).toEqual(['104.01', '92']);
  });

  it('below min notional -> no order, order_skipped_min_notional', () => {
    // 10% of 40 = 4 USDT < 5
    expect(planEntry(input({ equity: d(40) }))).toMatchObject({
      type: 'skip',
      reason: 'min_notional',
      events: ['order_skipped_min_notional'],
    });
  });

  it('below min quantity -> no order', () => {
    const filters = { ...FILTERS, stepSize: d(1), minQty: d(1) };
    // notional 50 at price 100 -> 0.5 -> rounds to 0
    expect(planEntry(input({ equity: d(500), filters }))).toMatchObject({ type: 'skip', reason: 'min_notional' });
  });
});

describe('AC8 / B9.2 leverage auto-lowering', () => {
  it('5x liquidation inside the stop -> leverage lowered until the 1% buffer holds (long)', () => {
    // 5x: liq = (100 - 20) / 0.996 = 80.32 -> stop 81 is only 0.68 away (< 1% of 100)
    // 4x: liq = (100 - 25) / 0.996 = 75.30 -> 5.7 away -> OK
    const plan = order({ stop: d(81) });
    expect(plan.leverage).toBe(4);
    expect(plan.leverageLoweredFrom).toBe(5);
    expect(plan.events).toEqual(['leverage_lowered']);
    expect(plan.liquidationPrice!.toFixed(2)).toBe('75.30');
  });

  it('short mirrors: liq above the stop by at least 1%', () => {
    // 5x: liq = 120 / 1.004 = 119.52 vs stop 119 -> 0.52 too close; 4x: 125 / 1.004 = 124.50 -> OK
    const plan = order({ side: 'short', stop: d(119) });
    expect(plan.leverage).toBe(4);
    expect(plan.liquidationPrice!.toFixed(2)).toBe('124.50');
  });

  it('B9.3: mode B keeps notional when leverage is lowered; only margin grows', () => {
    const at5 = order({ stop: d(90) });
    const lowered = order({ stop: d(81) });
    expect(at5.leverage).toBe(5);
    expect(lowered.notional.toString()).toBe(at5.notional.toString());
    expect(lowered.margin.toString()).toBe('250');
    expect(at5.margin.toString()).toBe('200');
  });

  it('mode A: lowering leverage lowers notional (margin fixed)', () => {
    const plan = order({ mode: 'A', stop: d(81) });
    expect(plan.notional.toString()).toBe('4000');
    expect(plan.margin.toString()).toBe('1000');
  });

  it('even 1x fails the check -> entry skipped (long)', () => {
    // 1x long: liq = 0 -> a stop at 0.5 is only 0.5 away (< 1)
    expect(planEntry(input({ stop: d('0.5') }))).toMatchObject({ type: 'skip', reason: 'liquidation' });
  });

  it('even 1x fails the check -> entry skipped (short)', () => {
    // 1x short: liq = 200 / 1.004 = 199.20 vs stop 199 -> 0.2 away
    expect(planEntry(input({ side: 'short', stop: d(199) }))).toMatchObject({ type: 'skip', reason: 'liquidation' });
  });

  it("the bracket's max leverage also caps the leverage", () => {
    const brackets = [{ ...BRACKETS[0]!, maxLeverage: 3 }];
    const plan = order({ brackets });
    expect(plan.leverage).toBe(3);
    expect(plan.leverageLoweredFrom).toBe(5);
  });

  it('no bracket for the notional -> skip', () => {
    const brackets = [{ ...BRACKETS[0]!, notionalCap: d(100) }];
    expect(planEntry(input({ brackets }))).toMatchObject({ type: 'skip', reason: 'no_bracket' });
  });
});

describe('input validation', () => {
  it('rejects leverage outside 1-20 (B10.1 hard max)', () => {
    expect(() => planEntry(input({ leverageCeiling: 21 }))).toThrow();
    expect(() => planEntry(input({ leverageCeiling: 0 }))).toThrow();
  });

  it('rejects a spot short, a stop on the wrong side and mode C without risk', () => {
    expect(() => planEntry(input({ market: 'spot', side: 'short', stop: d(104) }))).toThrow();
    expect(() => planEntry(input({ stop: d(101) }))).toThrow();
    expect(() => planEntry(input({ mode: 'C', riskPct: undefined }))).toThrow();
  });
});
