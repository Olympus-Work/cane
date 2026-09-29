import fc from 'fast-check';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { bracketFor, liquidationPrice, stopInsideLiquidation, type LeverageBracket } from '../src/risk/leverage.js';
import {
  planEntry,
  targetNotional,
  type EntryPlan,
  type EntryPlanInput,
} from '../src/sizing/size.js';

const HUNDRED = new Decimal(100);

/**
 * Three leverage-bracket tables so the generated notionals cross bracket
 * boundaries. Decimals are built from strings; maxLeverage is a number.
 */
const TABLE_SINGLE = [
  { notionalFloor: '0', notionalCap: '1e15', maintMarginRatio: '0.004', cum: '0', maxLeverage: 125 },
];

const TABLE_BINANCE_LIKE = [
  { notionalFloor: '0', notionalCap: '50000', maintMarginRatio: '0.004', cum: '0', maxLeverage: 125 },
  { notionalFloor: '50000', notionalCap: '250000', maintMarginRatio: '0.005', cum: '50', maxLeverage: 100 },
  { notionalFloor: '250000', notionalCap: '1000000', maintMarginRatio: '0.01', cum: '1300', maxLeverage: 50 },
  { notionalFloor: '1000000', notionalCap: '1e15', maintMarginRatio: '0.025', cum: '16300', maxLeverage: 20 },
];

const TABLE_DISCONTINUOUS = [
  { notionalFloor: '0', notionalCap: '500000', maintMarginRatio: '0.001', cum: '0', maxLeverage: 75 },
  { notionalFloor: '500000', notionalCap: '1e15', maintMarginRatio: '0.002', cum: '2000', maxLeverage: 75 },
];

const arbBrackets: fc.Arbitrary<readonly LeverageBracket[]> = fc
  .constantFrom(TABLE_SINGLE, TABLE_BINANCE_LIKE, TABLE_DISCONTINUOUS)
  .map((rows) =>
    rows.map((b) => ({
      notionalFloor: new Decimal(b.notionalFloor),
      notionalCap: new Decimal(b.notionalCap),
      maintMarginRatio: new Decimal(b.maintMarginRatio),
      cum: new Decimal(b.cum),
      maxLeverage: b.maxLeverage,
    })),
  );

/**
 * One EntryPlanInput. All magnitudes are generated as integers and turned into
 * Decimals via /100 (or /10000 for basis points) — never from JS floats.
 * Equity comes in two magnitude bands so bracket boundaries are crossed often;
 * freeBalance is a per-mille fraction of equity, computed with integer math.
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
    equityCents: fc.oneof(
      fc.integer({ min: 10_000, max: 100_000_000 }),
      fc.integer({ min: 2_000_000_000, max: 50_000_000_000 }),
    ),
    freeBalancePerMille: fc.integer({ min: 0, max: 1000 }),
    entryCents: fc.integer({ min: 100, max: 10_000_000 }),
    stopBps: fc.integer({ min: 50, max: 3000 }),
    hasTakeProfit: fc.boolean(),
    stepSize: fc.constantFrom('0.001', '0.01', '1'),
    tickSize: fc.constantFrom('0.01', '0.1'),
    brackets: arbBrackets,
  })
  .map((r) => {
    const market = r.market;
    const side = market === 'spot' ? 'long' : r.side;
    const equity = new Decimal(r.equityCents).div(HUNDRED);
    // floor(equityCents × perMille / 1000) in integer math — stays an integer.
    const freeBalanceCents = Number((BigInt(r.equityCents) * BigInt(r.freeBalancePerMille)) / 1000n);
    const freeBalance = new Decimal(freeBalanceCents).div(HUNDRED);
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
      brackets: r.brackets,
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

  it('10. futures order: the bracket of the final notional allows the leverage and the liquidation price is self-consistent', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const plan = runPlan(input);
        if (plan.type !== 'order' || input.market !== 'futures') return;
        const bracket = bracketFor(input.brackets!, plan.notional);
        expect(bracket).not.toBeNull();
        expect(plan.leverage).toBeLessThanOrEqual(bracket!.maxLeverage);
        const liq = liquidationPrice({
          side: input.side,
          entryPrice: input.entryPrice,
          quantity: plan.quantity,
          leverage: plan.leverage,
          bracket: bracket!,
        });
        expect(plan.liquidationPrice!.equals(liq)).toBe(true);
        expect(stopInsideLiquidation(input.side, input.entryPrice, plan.stop, plan.liquidationPrice!)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });
});

describe('planEntry: free-balance cap that crosses a bracket boundary (PR #3 review)', () => {
  // Discontinuous table: the lower bracket has a lower MMR but no maintenance amount,
  // so shrinking the notional below 500,000 can move liquidation closer to entry.
  const brackets = [
    { notionalFloor: new Decimal(0), notionalCap: new Decimal(500_000), maintMarginRatio: new Decimal('0.001'), cum: new Decimal(0), maxLeverage: 75 },
    { notionalFloor: new Decimal(500_000), notionalCap: new Decimal('1e15'), maintMarginRatio: new Decimal('0.002'), cum: new Decimal(2000), maxLeverage: 75 },
  ];
  const arbCrossing = fc
    .record({
      side: fc.constantFrom('long' as const, 'short' as const),
      lev: fc.integer({ min: 10, max: 20 }),
      stopBps: fc.integer({ min: 300, max: 700 }),
      targetK: fc.integer({ min: 500, max: 700 }), // target notional 500k..700k
      freePerMille: fc.integer({ min: 700, max: 999 }), // free = 70%..99.9% of target margin
    })
    .map((r): EntryPlanInput => {
      const entryPrice = new Decimal(100);
      const bps = new Decimal(r.stopBps).div(10_000);
      const targetMargin = new Decimal(r.targetK).times(1000).div(r.lev);
      return {
        market: 'futures',
        side: r.side,
        mode: 'A',
        basePct: new Decimal(10),
        presentFactors: 0,
        leverageCeiling: r.lev,
        equity: targetMargin.times(10), // mode A: margin = 10% x equity
        freeBalance: targetMargin.times(r.freePerMille).div(1000).floor(),
        entryPrice,
        stop: r.side === 'long' ? entryPrice.times(new Decimal(1).minus(bps)) : entryPrice.times(new Decimal(1).plus(bps)),
        takeProfit: null,
        filters: { stepSize: new Decimal('0.001'), tickSize: new Decimal('0.01'), minQty: new Decimal('0.001'), minNotional: new Decimal(5) },
        brackets,
      };
    });

  it('the 1% liquidation buffer holds on the final order', () => {
    fc.assert(
      fc.property(arbCrossing, (input) => {
        const plan = planEntry(input);
        if (plan.type !== 'order') return;
        expect(stopInsideLiquidation(input.side, input.entryPrice, plan.stop, plan.liquidationPrice!)).toBe(true);
      }),
      { numRuns: 3000 },
    );
  });
});
