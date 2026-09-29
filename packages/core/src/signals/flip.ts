import type { Decimal } from 'decimal.js';
import type { Market, Side } from '../types.js';

/** B6.1 default: a factor counts when Jev says present with confidence >= 0.70. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/** B7.5: a flip needs at least this many opposite-side factors present. */
export const FLIP_MIN_FACTORS = 2;

export interface JevFactor {
  present: boolean;
  /** 0..1 */
  confidence: number;
}

/** Jev answer for the three factors of one side (B8.3), or a failure (B8.4). */
export type JevResult =
  | { ok: true; factors: readonly [JevFactor, JevFactor, JevFactor] }
  | { ok: false; reason: 'timeout' | 'error' | 'invalid_response' };

/** B6.1: number of present factors; a Jev failure counts as none present (B8.4). */
export function presentFactorCount(jev: JevResult, threshold: number = DEFAULT_CONFIDENCE_THRESHOLD): number {
  if (!jev.ok) return 0;
  return jev.factors.filter((f) => f.present && f.confidence >= threshold).length;
}

export type PositionExitReason = 'first_red' | 'first_green' | 'stop' | 'take_profit' | 'kill_switch' | 'manual' | 'liquidated';

export type FlipDecision =
  | { flip: true; side: Side; presentFactors: number }
  | {
      flip: false;
      reason: 'spot' | 'not_opposite_signal' | 'not_profitable' | 'jev_failed' | 'too_few_factors';
    };

export interface FlipInput {
  market: Market;
  /** Side of the position that just closed. */
  closedSide: Side;
  exitReason: PositionExitReason;
  /** Realised PnL of the closed position after fees and funding. */
  realisedPnl: Decimal;
  /** Jev classification of the opposite side's factors on the same candle. */
  jev: JevResult;
  threshold?: number;
}

/**
 * B7.5 flip: after a futures position is closed by the opposite 1D signal
 * with realised profit, open the opposite side on the same candle only if at
 * least 2 of its factors are present. The 1W filter does not apply. No flip
 * on a loss, a stop / take-profit exit, a spot strategy or a Jev failure.
 * The exit itself always happens; this only decides the opposite entry.
 */
export function decideFlip(input: FlipInput): FlipDecision {
  if (input.market !== 'futures') return { flip: false, reason: 'spot' };
  const opposite = input.closedSide === 'long' ? 'first_red' : 'first_green';
  if (input.exitReason !== opposite) return { flip: false, reason: 'not_opposite_signal' };
  if (!input.realisedPnl.gt(0)) return { flip: false, reason: 'not_profitable' };
  if (!input.jev.ok) return { flip: false, reason: 'jev_failed' };
  const present = presentFactorCount(input.jev, input.threshold ?? DEFAULT_CONFIDENCE_THRESHOLD);
  if (present < FLIP_MIN_FACTORS) return { flip: false, reason: 'too_few_factors' };
  return { flip: true, side: input.closedSide === 'long' ? 'short' : 'long', presentFactors: present };
}
