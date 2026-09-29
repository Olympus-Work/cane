import { Decimal } from 'decimal.js';
import {
  bracketFor,
  liquidationPrice,
  stopInsideLiquidation,
  validateLeverage,
  type LeverageBracket,
} from '../risk/leverage.js';
import type { Market, Side } from '../types.js';

export type SizingMode = 'A' | 'B' | 'C';

/** B6.2: each present confluence factor adds this many percent. */
export const FACTOR_BONUS_PCT = 20;
export const MAX_SIZE_PCT = 100;
export const BASE_PCT_MIN = 5;
export const BASE_PCT_MAX = 20;

/** Binance symbol filters used for rounding (LOT_SIZE / MARKET_LOT_SIZE, PRICE_FILTER, MIN_NOTIONAL). */
export interface SymbolFilters {
  stepSize: Decimal;
  tickSize: Decimal;
  minQty: Decimal;
  minNotional: Decimal;
}

/** B6.2: `size_pct = base_pct + 20 × present`, capped at 100. */
export function sizePct(basePct: Decimal, presentFactors: number): Decimal {
  if (basePct.lt(BASE_PCT_MIN) || basePct.gt(BASE_PCT_MAX)) {
    throw new Error(`base_pct must be ${BASE_PCT_MIN}-${BASE_PCT_MAX}, got ${basePct.toString()}`);
  }
  if (!Number.isInteger(presentFactors) || presentFactors < 0 || presentFactors > 3) {
    throw new Error(`present factors must be 0-3, got ${presentFactors}`);
  }
  return Decimal.min(MAX_SIZE_PCT, basePct.plus(FACTOR_BONUS_PCT * presentFactors));
}

/** B6.6: quantity is rounded down to the step size. */
export function roundDownToStep(value: Decimal, step: Decimal): Decimal {
  if (step.lte(0)) throw new Error('step must be > 0');
  return value.div(step).floor().times(step);
}

/** Price rounded to the tick size in the given direction. */
export function roundToTick(price: Decimal, tick: Decimal, direction: 'down' | 'up'): Decimal {
  if (tick.lte(0)) throw new Error('tick must be > 0');
  const units = price.div(tick);
  return (direction === 'down' ? units.floor() : units.ceil()).times(tick);
}

/**
 * Unrounded notional and margin for one leverage (B6.4).
 * - B: notional = size% × equity; margin = notional / lev
 * - A: margin = size% × equity; notional = margin × lev
 * - C: effective risk = risk% × size% / 100; notional = (effRisk% × equity) / R × entry
 */
export function targetNotional(args: {
  mode: SizingMode;
  sizePct: Decimal;
  equity: Decimal;
  leverage: number;
  entryPrice: Decimal;
  stop: Decimal;
  riskPct?: Decimal;
}): { notional: Decimal; margin: Decimal } {
  const { mode, equity, leverage, entryPrice, stop } = args;
  const frac = args.sizePct.div(100);
  if (mode === 'B') {
    const notional = equity.times(frac);
    return { notional, margin: notional.div(leverage) };
  }
  if (mode === 'A') {
    const margin = equity.times(frac);
    return { notional: margin.times(leverage), margin };
  }
  if (args.riskPct === undefined || args.riskPct.lte(0)) throw new Error('mode C needs risk_pct > 0');
  const r = entryPrice.minus(stop).abs();
  if (r.isZero()) throw new Error('mode C needs a stop distance > 0');
  const riskAmount = equity.times(args.riskPct.div(100)).times(frac);
  const notional = riskAmount.div(r).times(entryPrice);
  return { notional, margin: notional.div(leverage) };
}

export interface EntryPlanInput {
  market: Market;
  side: Side;
  /** Futures only; spot always uses mode B with leverage 1 (B6.4). */
  mode: SizingMode;
  basePct: Decimal;
  /** 0-3. Late entries and Jev fallbacks pass 0 (B4.4, B8.4). */
  presentFactors: number;
  riskPct?: Decimal;
  /** Configured leverage = ceiling (futures). */
  leverageCeiling: number;
  /** B6.3 equity at sizing time. */
  equity: Decimal;
  /** Free balance available for this order (spot: quote asset; futures: available margin). */
  freeBalance: Decimal;
  entryPrice: Decimal;
  stop: Decimal;
  takeProfit: Decimal | null;
  filters: SymbolFilters;
  /** Futures only: the symbol's leverage brackets. */
  brackets?: readonly LeverageBracket[];
}

export type EntryPlanEvent = 'sizing_reduced' | 'leverage_lowered' | 'order_skipped_min_notional';

export type EntryPlan =
  | {
      type: 'order';
      quantity: Decimal;
      notional: Decimal;
      margin: Decimal;
      sizePct: Decimal;
      leverage: number;
      /** Set when B9.2 lowered leverage below the ceiling. */
      leverageLoweredFrom: number | null;
      stop: Decimal;
      takeProfit: Decimal | null;
      liquidationPrice: Decimal | null;
      events: EntryPlanEvent[];
    }
  | {
      type: 'skip';
      reason: 'min_notional' | 'liquidation' | 'no_bracket';
      sizePct: Decimal;
      events: EntryPlanEvent[];
    };

/**
 * B6 + B9.2 for one entry. Order of work:
 * 1. size_pct from factors;
 * 2. futures: from the leverage ceiling down to 1x, the first leverage whose
 *    liquidation price sits at least 1% of entry beyond the stop (and that the
 *    notional's bracket allows); none → skip;
 * 3. cap to free balance (`sizing_reduced`);
 * 4. round quantity down to step, stop / TP to tick (away from price for the
 *    stop, towards price for the TP); below min qty / min notional → skip.
 */
export function planEntry(input: EntryPlanInput): EntryPlan {
  const { market, side, entryPrice, filters } = input;
  if (market === 'spot' && side === 'short') throw new Error('spot is long only');
  if (entryPrice.lte(0) || input.equity.lt(0) || input.freeBalance.lt(0)) throw new Error('invalid prices or balances');
  if (side === 'long' ? !input.stop.lt(entryPrice) : !input.stop.gt(entryPrice)) {
    throw new Error('stop must be on the protective side of the entry price');
  }
  const pct = sizePct(input.basePct, input.presentFactors);
  const events: EntryPlanEvent[] = [];
  const mode: SizingMode = market === 'spot' ? 'B' : input.mode;
  const ceiling = market === 'spot' ? 1 : input.leverageCeiling;
  validateLeverage(ceiling);

  // Stop / TP rounded first so the liquidation check uses the price actually sent.
  const stop = roundToTick(input.stop, filters.tickSize, side === 'long' ? 'down' : 'up');
  const takeProfit =
    input.takeProfit === null ? null : roundToTick(input.takeProfit, filters.tickSize, side === 'long' ? 'down' : 'up');

  const target = (lev: number) =>
    targetNotional({ mode, sizePct: pct, equity: input.equity, leverage: lev, entryPrice, stop, riskPct: input.riskPct });

  let leverage = ceiling;
  if (market === 'futures') {
    const brackets = input.brackets ?? [];
    let chosen: number | null = null;
    for (let lev = ceiling; lev >= 1; lev--) {
      const { notional } = target(lev);
      const bracket = bracketFor(brackets, notional);
      if (bracket === null) return { type: 'skip', reason: 'no_bracket', sizePct: pct, events };
      if (lev > bracket.maxLeverage) continue;
      if (notional.lte(0)) break;
      const liq = liquidationPrice({ side, entryPrice, quantity: notional.div(entryPrice), leverage: lev, bracket });
      if (stopInsideLiquidation(side, entryPrice, stop, liq)) {
        chosen = lev;
        break;
      }
    }
    if (chosen === null) return { type: 'skip', reason: 'liquidation', sizePct: pct, events };
    if (chosen < ceiling) events.push('leverage_lowered');
    leverage = chosen;
  }

  // B6.5: cap to the free balance (spot needs the full notional, futures the margin).
  const t = target(leverage);
  let notional = t.notional;
  const required = market === 'spot' ? t.notional : t.margin;
  if (required.gt(input.freeBalance)) {
    events.push('sizing_reduced');
    notional = input.freeBalance.times(leverage);
  }

  // B6.6: quantity rounded down to step; below minimums -> no order.
  const quantity = roundDownToStep(notional.div(entryPrice), filters.stepSize);
  const finalNotional = quantity.times(entryPrice);
  if (quantity.lte(0) || quantity.lt(filters.minQty) || finalNotional.lt(filters.minNotional)) {
    events.push('order_skipped_min_notional');
    return { type: 'skip', reason: 'min_notional', sizePct: pct, events };
  }

  let liq: Decimal | null = null;
  if (market === 'futures') {
    const bracket = bracketFor(input.brackets ?? [], finalNotional);
    if (bracket === null) return { type: 'skip', reason: 'no_bracket', sizePct: pct, events };
    liq = liquidationPrice({ side, entryPrice, quantity, leverage, bracket });
  }

  return {
    type: 'order',
    quantity,
    notional: finalNotional,
    margin: finalNotional.div(leverage),
    sizePct: pct,
    leverage,
    leverageLoweredFrom: leverage < ceiling ? ceiling : null,
    stop,
    takeProfit,
    liquidationPrice: liq,
    events,
  };
}
