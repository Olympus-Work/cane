import fc from 'fast-check';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { stopInsideLiquidation } from '../src/risk/leverage.js';
import {
  planEntry,
  targetNotional,
  type EntryPlan,
  type EntryPlanInput,
} from '../src/sizing/size.js';

const HUNDRED = new Decimal(100);

/**
 * One EntryPlanInput. All magnitudes are generated as integers and turned into
 * Decimals via /100 (or /10000 for basis points) — never from JS floats.
 */
const arbInput: fc.Arbitrary<EntryPlanInput> = fc
  .record({
    market: fc.constantFrom('spot' as const, 'futures' as const),
    side: fc.constantFrom('long' as const, 'short' as const),
    mode: fc.constantFrom('A' as const, 'B' as const, 'C' as const),
    basePct: fc.integer({ min: 5, max: 20 }),
    presentFactors: fc.integer({ min: 0, max: 3 }),
    riskPctCents: fc.integer({ min: 1, max: 500 }),
    leverageCeiling: fc.integer({ min: 1, max: 20 }),
    equityCents: fc.integer({ min: 10_000, max: 100_000_000 }),
    freeBalanceCents: fc.integer({ min: 0, max: 100_000_000 }),
    entryCents: fc.integer({ min: 100, max: 10_000_000 }),
    stopBps: fc.integer({ min: 50, max: 3000 }),
    hasTakeProfit: fc.boolean(),
    stepSize: fc.constantFrom('0.001', '0.01', '1'),
    tickSize: fc.constantFrom('0.01', '0.1'),
  })
  .map((r) => {
    const market = r.market;
    const side = market === 'spot' ? 'long' : r.side;
    const equity = new Decimal(r.equityCents).div(HUNDRED);
    const freeBalance = new Decimal(Math.min(r.freeBalanceCents, r.equityCents)).div(HUNDRED);
    const entryPrice = new Decimal(r.entryCents).div(HUNDRED);
    const bps = new Decimal(r.stopBps).div(10_000);
    const stop =
      side === 'long' ? entryPrice.times(new Decimal(1).minus(bps)) : entryPrice.times(new Decimal(1).plus(bps));
    let takeProfit: Decimal | null = null;
    if (r.hasTakeProfit) {
      const tp =
        side === 'long'
          ? entryPrice.times(new Decimal(1).plus(bps.times(2)))
          : entryPrice.times(new Decimal(1).minus(bps.times(2)));
      if (tp.gt(0)) takeProfit = tp;
    }
    const stepSize = new Decimal(r.stepSize);
    return {
      market,
      side,
      mode: r.mode,
      basePct: new Decimal(r.basePct),
      presentFactors: r.presentFactors,
      riskPct: new Decimal(r.riskPctCents).div(HUNDRED),
      leverageCeiling: r.leverageCeiling,
      equity,
      freeBalance,
      entryPrice,
      stop,
      takeProfit,
      filters: { stepSize, tickSize: new Decimal(r.tickSize), minQty: stepSize, minNotional: new Decimal(5) },
      brackets: [
        {
          notionalFloor: new Decimal(0),
          notionalCap: new Decimal('1e15'),
          maintMarginRatio: new Decimal('0.004'),
          cum: new Decimal(0),
          maxLeverage: 125,
        },
      ],
    };
  });

/**
 * planEntry, with the one expected throw filtered out: a tight stop distance
 * against a coarse tick can round the stop onto the wrong side of the entry.
 * Any other throw is a real failure and is rethrown.
 */
function runPlan(input: EntryPlanInput): EntryPlan {
  try {
    return planEntry(input);
  } catch (error) {
    if (error instanceof Error && error.message.includes('protective side')) fc.pre(false);
    throw error;
  }
}

describe('planEntry properties', () => {
  it('1. order quantity is positive and a whole multiple of the step size', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const plan = runPlan(input);
        if (plan.type !== 'order') return;
        expect(plan.quantity.gt(0)).toBe(true);
        expect(plan.quantity.div(input.filters.stepSize).isInteger()).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it('2. order stays within the free balance (futures: margin, spot: notional)', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const plan = runPlan(input);
        if (plan.type !== 'order') return;
        if (input.market === 'futures') {
          expect(plan.margin.lte(input.freeBalance)).toBe(true);
        } else {
          expect(plan.notional.lte(input.freeBalance)).toBe(true);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('3. order notional is exactly quantity × entryPrice and at least the minimum', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const plan = runPlan(input);
        if (plan.type !== 'order') return;
        expect(plan.notional.equals(plan.quantity.times(input.entryPrice))).toBe(true);
        expect(plan.notional.gte(input.filters.minNotional)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it('4. leverage is within [1, ceiling], loweredFrom and the event agree', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const plan = runPlan(input);
        if (plan.type !== 'order') return;
        const ceiling = input.market === 'spot' ? 1 : input.leverageCeiling;
        expect(plan.leverage).toBeGreaterThanOrEqual(1);
        expect(plan.leverage).toBeLessThanOrEqual(ceiling);
        if (input.market === 'spot') expect(plan.leverage).toBe(1);
        expect(plan.leverageLoweredFrom === null).toBe(plan.leverage === ceiling);
        expect(plan.events.includes('leverage_lowered')).toBe(plan.leverageLoweredFrom !== null);
      }),
      { numRuns: 2000 },
    );
  });

  it('5. order stop is tick-aligned and on the protective side of the entry', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const plan = runPlan(input);
        if (plan.type !== 'order') return;
        expect(plan.stop.div(input.filters.tickSize).isInteger()).toBe(true);
        if (input.side === 'long') expect(plan.stop.lt(input.entryPrice)).toBe(true);
        else expect(plan.stop.gt(input.entryPrice)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it('6. futures order: liquidation price exists and the stop sits inside it', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const plan = runPlan(input);
        if (plan.type !== 'order' || input.market !== 'futures') return;
        expect(plan.liquidationPrice).not.toBeNull();
        expect(stopInsideLiquidation(input.side, input.entryPrice, plan.stop, plan.liquidationPrice!)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it('7. sizePct is min(100, basePct + 20 × presentFactors) for order and skip alike', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const plan = runPlan(input);
        const expected = Decimal.min(new Decimal(100), input.basePct.plus(20 * input.presentFactors));
        expect(plan.sizePct.equals(expected)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it('8. without sizing_reduced the order notional does not exceed the unrounded target', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const plan = runPlan(input);
        if (plan.type !== 'order' || plan.events.includes('sizing_reduced')) return;
        const target = targetNotional({
          mode: input.market === 'spot' ? 'B' : input.mode,
          sizePct: plan.sizePct,
          equity: input.equity,
          leverage: plan.leverage,
          entryPrice: input.entryPrice,
          stop: plan.stop,
          riskPct: input.riskPct,
        });
        expect(plan.notional.lte(target.notional)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it('9. zero free balance always skips', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        if (!input.freeBalance.isZero()) return;
        const plan = runPlan(input);
        expect(plan.type).toBe('skip');
      }),
      { numRuns: 2000 },
    );
  });
});
