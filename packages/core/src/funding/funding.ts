import { Decimal } from 'decimal.js';

/** Funding intervals Binance USDⓈ-M uses per symbol (spec B2: read per symbol, never assumed 8h). */
export const FUNDING_INTERVAL_HOURS = [1, 2, 4, 8] as const;

export const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** One settled funding event as the exchange reports it (times are UTC ms). */
export interface SettledFunding {
  fundingTime: number;
  rate: Decimal;
  /** Older Binance rows carry an empty mark price. */
  markPrice: Decimal | null;
}

/** A settled funding event with the interval it covered (spec Data `funding_rate`). */
export interface FundingEvent extends SettledFunding {
  intervalHours: number;
}

/** spec B3: `funding_apr = rate × (24 / interval_hours) × 365`, as a fraction (0.1 = 10% / yr). */
export function fundingApr(rate: Decimal, intervalHours: number): Decimal {
  if (!Number.isFinite(intervalHours) || intervalHours <= 0) {
    throw new Error(`fundingApr: interval must be > 0 hours, got ${intervalHours}`);
  }
  return rate.times(24).dividedBy(intervalHours).times(365);
}

/** Some historic funding times carry a few ms of offset; compare them by the minute. */
function toMinute(timeMs: number): number {
  return Math.round(timeMs / MINUTE_MS) * MINUTE_MS;
}

/** Hours between two funding times, compared by the minute. */
export function hoursBetween(earlier: number, later: number): number {
  return (toMinute(later) - toMinute(earlier)) / HOUR_MS;
}

function isFundingInterval(hours: number): boolean {
  return (FUNDING_INTERVAL_HOURS as readonly number[]).includes(hours);
}

export interface IntervalContext {
  /** Funding time of the stored event just before `events[0]`, if any. */
  previousTime?: number;
  /** Interval of that stored event; carried forward over an irregular gap. */
  previousIntervalHours?: number;
  /** Used only when nothing else gives an interval (a single new event, nothing stored). */
  fallbackIntervalHours?: number;
}

/**
 * Gives each settled event the interval it covered, read from the exchange's own
 * timestamps (spec B2): the gap to the previous event. When that gap is not a
 * funding interval (events missing), the previous event's interval is carried
 * forward; the gap itself is reported by `fundingGaps`. The very first event,
 * with nothing before it, takes the first regular gap ahead of it.
 * `events` must be sorted by `fundingTime`, ascending, without duplicates.
 */
export function withIntervals(events: readonly SettledFunding[], ctx: IntervalContext = {}): FundingEvent[] {
  let last = ctx.previousTime;
  for (const e of events) {
    if (last !== undefined && e.fundingTime <= last) {
      throw new Error(`withIntervals: events must be ascending and unique (${e.fundingTime} after ${last})`);
    }
    last = e.fundingTime;
  }
  const out: FundingEvent[] = [];
  let prevTime = ctx.previousTime;
  let prevInterval = ctx.previousIntervalHours;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    let interval: number | undefined;
    const back = prevTime === undefined ? undefined : hoursBetween(prevTime, e.fundingTime);
    if (back !== undefined && isFundingInterval(back)) {
      interval = back;
    } else if (prevInterval !== undefined) {
      interval = prevInterval;
    } else {
      interval = firstRegularGap(events, i) ?? ctx.fallbackIntervalHours;
    }
    if (interval === undefined || !isFundingInterval(interval)) {
      throw new Error(`withIntervals: no funding interval for event at ${new Date(e.fundingTime).toISOString()}`);
    }
    out.push({ ...e, intervalHours: interval });
    prevTime = e.fundingTime;
    prevInterval = interval;
  }
  return out;
}

/** The first gap after `events[from]` that is a funding interval (a batch may start across a hole). */
function firstRegularGap(events: readonly SettledFunding[], from: number): number | undefined {
  for (let j = from + 1; j < events.length; j++) {
    const gap = hoursBetween(events[j - 1]!.fundingTime, events[j]!.fundingTime);
    if (isFundingInterval(gap)) return gap;
  }
  return undefined;
}

export type FundingGapReason = 'irregular_interval' | 'missing_in_steady_interval' | 'missing_start' | 'missing_end';

export interface FundingGap {
  reason: FundingGapReason;
  /** Last event before the gap (null when the gap is at the start). */
  after: number | null;
  /** First event after the gap (null when the gap is at the end). */
  before: number | null;
  hours: number;
}

/**
 * Gap check for stored funding history (plan F01 "Gap rule"). Events must be
 * sorted ascending. `from` / `to` bound the window that must be covered; `to`
 * is normally "now", and the interval still running at `to` is not a gap.
 */
export function fundingGaps(events: readonly FundingEvent[], from: number, to: number): FundingGap[] {
  if (events.length === 0) {
    return [{ reason: 'missing_start', after: null, before: null, hours: (to - from) / HOUR_MS }];
  }
  const gaps: FundingGap[] = [];
  const first = events[0]!;
  const startGap = (toMinute(first.fundingTime) - toMinute(from)) / HOUR_MS;
  if (startGap > first.intervalHours) {
    gaps.push({ reason: 'missing_start', after: null, before: first.fundingTime, hours: startGap });
  }

  const diffs: number[] = [];
  for (let i = 1; i < events.length; i++) {
    diffs.push(hoursBetween(events[i - 1]!.fundingTime, events[i]!.fundingTime));
  }
  diffs.forEach((d, i) => {
    const after = events[i]!.fundingTime;
    const before = events[i + 1]!.fundingTime;
    if (!isFundingInterval(d)) {
      gaps.push({ reason: 'irregular_interval', after, before, hours: d });
      return;
    }
    const prev = diffs[i - 1];
    const next = diffs[i + 1];
    if (prev !== undefined && next !== undefined && prev === next && d > prev && d % prev === 0) {
      gaps.push({ reason: 'missing_in_steady_interval', after, before, hours: d });
    }
  });

  const last = events[events.length - 1]!;
  const endGap = (toMinute(to) - toMinute(last.fundingTime)) / HOUR_MS;
  if (endGap > last.intervalHours) {
    gaps.push({ reason: 'missing_end', after: last.fundingTime, before: null, hours: endGap });
  }
  return gaps;
}
