import { Decimal } from 'decimal.js';
import type { Side } from '../types.js';

/** B10.1: 20x is a hard maximum even where Binance allows more. */
export const MAX_LEVERAGE = 20;

/** B9.2: the stop must sit closer to entry than liquidation by at least 1% of entry. */
export const LIQUIDATION_BUFFER = new Decimal('0.01');

/** One USDⓈ-M leverage bracket (Binance `leverageBracket`), for one symbol. */
export interface LeverageBracket {
  /** Notional (USDT) this bracket applies from, inclusive. */
  notionalFloor: Decimal;
  /** Notional (USDT) this bracket applies up to, exclusive. */
  notionalCap: Decimal;
  /** Maintenance margin rate, e.g. 0.004. */
  maintMarginRatio: Decimal;
  /** Maintenance amount ("cum") in USDT. */
  cum: Decimal;
  /** Highest leverage Binance allows in this bracket. */
  maxLeverage: number;
}

export function bracketFor(brackets: readonly LeverageBracket[], notional: Decimal): LeverageBracket | null {
  return brackets.find((b) => notional.gte(b.notionalFloor) && notional.lt(b.notionalCap)) ?? null;
}

/**
 * Estimated liquidation price of a single isolated position in one-way mode
 * (Binance formula, fees ignored, wallet balance = initial margin):
 *   long:  (EP − EP/lev − cum/Q) / (1 − MMR)
 *   short: (EP + EP/lev + cum/Q) / (1 + MMR)
 * Cross margin can use more of the account, so its real liquidation price is
 * the same or further away: this estimate is conservative for cross.
 */
export function liquidationPrice(args: {
  side: Side;
  entryPrice: Decimal;
  quantity: Decimal;
  leverage: number;
  bracket: Pick<LeverageBracket, 'maintMarginRatio' | 'cum'>;
}): Decimal {
  const { side, entryPrice: ep, quantity: q, leverage, bracket } = args;
  if (q.lte(0)) throw new Error('quantity must be > 0');
  const perUnitCum = bracket.cum.div(q);
  const marginPerUnit = ep.div(leverage);
  return side === 'long'
    ? ep.minus(marginPerUnit).minus(perUnitCum).div(new Decimal(1).minus(bracket.maintMarginRatio))
    : ep.plus(marginPerUnit).plus(perUnitCum).div(new Decimal(1).plus(bracket.maintMarginRatio));
}

/** True when the stop sits at least the buffer (1% of entry) inside liquidation. */
export function stopInsideLiquidation(side: Side, entryPrice: Decimal, stop: Decimal, liq: Decimal): boolean {
  const buffer = entryPrice.times(LIQUIDATION_BUFFER);
  return side === 'long' ? stop.minus(liq).gte(buffer) : liq.minus(stop).gte(buffer);
}

export function validateLeverage(leverage: number): void {
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > MAX_LEVERAGE) {
    throw new Error(`leverage must be an integer 1-${MAX_LEVERAGE}, got ${leverage}`);
  }
}
