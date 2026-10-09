import { Decimal } from 'decimal.js';
import type { Decision, OpenPosition } from '@cane/core';

/** Outcome of one 4H evaluation key (plan S13). */
export type DiffOutcome = 'match' | 'differ' | 'missing_live' | 'missing_replay';

export interface KeyDiff {
  /** Open time of the evaluated 4H candle (UTC ms). */
  key: number;
  outcome: DiffOutcome;
  /** Compact text of each side, set when the outcome is not `match`. */
  live?: string;
  replay?: string;
  /** Where the position given to the replay came from (set on non-matches by the diff service). */
  position?: PositionSource;
}

/** `recorded`: the engine's `input.position`; `rebuilt`: from positions/orders; `unreadable`: an `input` the diff could not parse, so rebuilt. */
export type PositionSource = 'recorded' | 'rebuilt' | 'unreadable';

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Decimals reach the DB as strings (Decimal.toJSON); null stays null. */
function sameDecimal(a: unknown, b: Decimal | null): boolean {
  if (b === null) return a === null || a === undefined;
  if (typeof a !== 'string' && typeof a !== 'number') return false;
  try {
    return new Decimal(a).eq(b);
  } catch {
    return false;
  }
}

function sameSignal(a: unknown, b: { timeframe: string; openTime: number }): boolean {
  return isObj(a) && a.timeframe === b.timeframe && Number(a.openTime) === b.openTime;
}

function sameList(a: unknown, b: readonly string[] | undefined): boolean {
  const left = Array.isArray(a) ? [...(a as string[])].sort() : [];
  const right = b ? [...b].sort() : [];
  return left.length === right.length && left.every((v, i) => v === right[i]);
}

/**
 * True when the live decision JSON (a `signals.decision`) carries the same
 * decision as the replay's. Only the fields of plan S13 are compared; keys
 * added later by `annotateSignal` are ignored.
 */
export function sameDecision(live: unknown, replay: Decision): boolean {
  if (!isObj(live) || live.type !== replay.type) return false;
  switch (replay.type) {
    case 'warming_up':
      return sameList(live.timeframes, replay.timeframes);
    case 'none':
      return live.reason === replay.reason;
    case 'enter':
      return (
        live.side === replay.side &&
        live.kind === replay.kind &&
        sameDecimal(live.refPrice, replay.refPrice) &&
        sameSignal(live.signal, replay.signal) &&
        sameDecimal(live.stop, replay.stop) &&
        live.stopSource === replay.stopSource &&
        sameDecimal(live.takeProfit, replay.takeProfit) &&
        live.trend1w === replay.trend1w
      );
    case 'exit':
      return live.side === replay.side && live.reason === replay.reason && sameSignal(live.signal, replay.signal) && sameDecimal(live.refPrice, replay.refPrice);
    case 'move_stop':
      return live.side === replay.side && sameDecimal(live.stop, replay.stop) && sameSignal(live.signal, replay.signal);
  }
}

/** One line for the log and `live-log.md`, e.g. `enter long primary 1d@… stop 61000`. */
export function describeDecision(d: unknown): string {
  if (!isObj(d)) return 'none recorded';
  const sig = isObj(d.signal) ? ` ${String(d.signal.timeframe)}@${new Date(Number(d.signal.openTime)).toISOString()}` : '';
  switch (d.type) {
    case 'warming_up':
      return `warming_up ${Array.isArray(d.timeframes) ? d.timeframes.join(',') : ''}`.trim();
    case 'none':
      return `none:${String(d.reason)}`;
    case 'enter':
      return `enter ${String(d.side)} ${String(d.kind)}${sig} stop ${String(d.stop)} tp ${String(d.takeProfit ?? '-')}`;
    case 'exit':
      return `exit ${String(d.side)} ${String(d.reason)}${sig}`;
    case 'move_stop':
      return `move_stop ${String(d.side)}${sig} stop ${String(d.stop)}`;
    default:
      return String(d.type);
  }
}

/**
 * Classifies one key. `live` is the recorded decision (undefined when live has
 * no row); `liveAround` says whether live has 4H rows both before and after
 * this key, so a gap inside a managed period counts while the time before the
 * strategy was enabled, or after it was disabled, does not.
 */
export function classifyKey(key: number, live: unknown, replay: Decision, liveAround: boolean): KeyDiff | null {
  const replayGap = replay.type === 'none' && replay.reason === 'data_gap';
  if (live === undefined) {
    if (replayGap || !liveAround) return null; // not an evaluation live was due to record
    return { key, outcome: 'missing_live', live: describeDecision(undefined), replay: describeDecision(replay) };
  }
  if (replayGap) return { key, outcome: 'missing_replay', live: describeDecision(live), replay: describeDecision(replay) };
  if (sameDecision(live, replay)) return { key, outcome: 'match' };
  return { key, outcome: 'differ', live: describeDecision(live), replay: describeDecision(replay) };
}

/**
 * The position live passed to `decide`, as the engine records it in the 4H
 * row (`input.position`, S13). `undefined` when the row predates that field.
 */
export function recordedPosition(live: unknown): OpenPosition | null | undefined {
  if (!isObj(live) || !isObj(live.input) || !('position' in live.input)) return undefined;
  const p = live.input.position;
  if (p === null) return null;
  if (!isObj(p) || (p.side !== 'long' && p.side !== 'short') || typeof p.stop !== 'string') return undefined;
  return { side: p.side, kind: p.kind === 'late' ? 'late' : 'primary', stop: new Decimal(p.stop), openedAt: Number(p.openedAt) };
}

/** The UTC day before `nowMs`, YYYY-MM-DD: the day the daily replay-diff checks. */
export function previousUtcDay(nowMs: number): string {
  return new Date(nowMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
