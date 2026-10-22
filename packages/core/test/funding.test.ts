import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  HOUR_MS,
  fundingApr,
  fundingGaps,
  withIntervals,
  type FundingEvent,
  type SettledFunding,
} from '../src/funding/funding.js';

const T0 = Date.UTC(2024, 0, 1); // 2024-01-01 00:00 UTC, a funding time for 1/4/8h symbols

function settled(hoursFromT0: number[], offsetMs = 0): SettledFunding[] {
  return hoursFromT0.map((h) => ({ fundingTime: T0 + h * HOUR_MS + offsetMs, rate: new Decimal('0.0001'), markPrice: null }));
}

function every(hours: number, count: number, startHour = 0): number[] {
  return Array.from({ length: count }, (_, i) => startHour + i * hours);
}

describe('fundingApr (B3)', () => {
  it('annualises by the actual interval', () => {
    expect(fundingApr(new Decimal('0.0001'), 8).toString()).toBe('0.1095');
    expect(fundingApr(new Decimal('0.0001'), 4).toString()).toBe('0.219');
    expect(fundingApr(new Decimal('0.0001'), 1).toString()).toBe('0.876');
  });

  it('keeps the sign of a negative rate', () => {
    expect(fundingApr(new Decimal('-0.00025'), 8).toString()).toBe('-0.27375');
  });

  it('stays exact in decimal (no float drift)', () => {
    expect(fundingApr(new Decimal('0.00003'), 8).toString()).toBe('0.03285');
  });

  it.each([0, -8, Number.NaN])('rejects interval %s', (h) => {
    expect(() => fundingApr(new Decimal('0.0001'), h)).toThrow();
  });
});

describe('withIntervals (B2)', () => {
  it('reads a steady 8h interval from the timestamps; the first event takes the gap to the next', () => {
    expect(withIntervals(settled(every(8, 4))).map((e) => e.intervalHours)).toEqual([8, 8, 8, 8]);
  });

  it('stores an interval change from the first event after it', () => {
    const events = withIntervals(settled([0, 8, 16, 20, 24, 28]));
    expect(events.map((e) => e.intervalHours)).toEqual([8, 8, 8, 4, 4, 4]);
  });

  it('continues from the stored event before the batch', () => {
    const events = withIntervals(settled([12, 16]), { previousTime: T0 + 8 * HOUR_MS, previousIntervalHours: 8 });
    expect(events.map((e) => e.intervalHours)).toEqual([4, 4]);
  });

  it('carries the previous interval over a gap instead of storing a 16h interval', () => {
    expect(withIntervals(settled([0, 8, 24, 32])).map((e) => e.intervalHours)).toEqual([8, 8, 8, 8]);
  });

  it('ignores a few ms of offset in old funding times', () => {
    const events = settled([0, 8, 16]).map((e, i) => ({ ...e, fundingTime: e.fundingTime + [3, 0, 7][i]! }));
    expect(withIntervals(events).map((e) => e.intervalHours)).toEqual([8, 8, 8]);
  });

  it('starts a batch that begins across a hole from the first regular gap ahead (PR #39 review)', () => {
    expect(withIntervals(settled([0, 16, 24, 32])).map((e) => e.intervalHours)).toEqual([8, 8, 8, 8]);
  });

  it('uses the fallback only for a lone first event', () => {
    expect(withIntervals(settled([0]), { fallbackIntervalHours: 4 })[0]!.intervalHours).toBe(4);
    expect(() => withIntervals(settled([0]))).toThrow(/no funding interval/);
  });

  it('rejects unsorted or duplicate events', () => {
    expect(() => withIntervals(settled([8, 0]))).toThrow(/ascending/);
    expect(() => withIntervals(settled([0, 0]))).toThrow(/ascending/);
  });

  it('keeps rate and mark price untouched', () => {
    const [e] = withIntervals([{ fundingTime: T0, rate: new Decimal('-0.0003'), markPrice: new Decimal('64000.1') }], {
      fallbackIntervalHours: 8,
    });
    expect(e!.rate.toString()).toBe('-0.0003');
    expect(e!.markPrice!.toString()).toBe('64000.1');
  });
});

describe('fundingGaps (plan F01 gap rule)', () => {
  const at = (h: number) => T0 + h * HOUR_MS;
  const events = (hours: number[]): FundingEvent[] => withIntervals(settled(hours));

  it('finds no gap in a steady, fully covered window', () => {
    expect(fundingGaps(events(every(8, 10)), at(0), at(75))).toEqual([]);
  });

  it('accepts an interval change 8h -> 4h', () => {
    expect(fundingGaps(events([0, 8, 16, 20, 24, 28, 32]), at(0), at(34))).toEqual([]);
  });

  it('flags an irregular gap (one 8h event missing gives 16h)', () => {
    expect(fundingGaps(events([0, 8, 24, 32]), at(0), at(34))).toEqual([
      { reason: 'irregular_interval', after: at(8), before: at(24), hours: 16 },
    ]);
  });

  it('flags one missing event inside a steady 4h interval (gap of 8h)', () => {
    expect(fundingGaps(events([0, 4, 8, 16, 20, 24]), at(0), at(26))).toEqual([
      { reason: 'missing_in_steady_interval', after: at(8), before: at(16), hours: 8 },
    ]);
  });

  it('flags missing coverage at the start and at the end', () => {
    expect(fundingGaps(events([24, 32, 40]), at(0), at(60))).toEqual([
      { reason: 'missing_start', after: null, before: at(24), hours: 24 },
      { reason: 'missing_end', after: at(40), before: null, hours: 20 },
    ]);
  });

  it('does not count the interval still running at `to`', () => {
    expect(fundingGaps(events([0, 8, 16]), at(0), at(23))).toEqual([]);
  });

  it('reports an empty history as one gap', () => {
    expect(fundingGaps([], at(0), at(48))).toEqual([{ reason: 'missing_start', after: null, before: null, hours: 48 }]);
  });

  it('ignores ms offsets when checking', () => {
    expect(fundingGaps(withIntervals(settled(every(8, 5), 5)), at(0), at(36))).toEqual([]);
  });

  // Aligned interval changes (plan "Gap rule", F01b): a short step onto a longer
  // interval's grid is not a gap. Real dates, as Binance reported them for ARKUSDT.
  const d8 = (h: number) => Date.UTC(2026, 9, 8, h); // 2026-10-08 UTC
  const d9 = (h: number) => Date.UTC(2026, 9, 9, h); // 2026-10-09 UTC
  const HALF_HOUR = 30 * 60 * 1000;
  const realEvents = (times: number[]): FundingEvent[] =>
    withIntervals(times.map((fundingTime) => ({ fundingTime, rate: new Decimal('0.0001'), markPrice: null })));

  it('accepts the ARKUSDT 1h -> 4h change: 17:00 -> 20:00 is 3h but lands on the 4h grid', () => {
    const times = [d8(12), d8(13), d8(14), d8(15), d8(16), d8(17), d8(20), d9(0), d9(4), d9(8)];
    expect(fundingGaps(realEvents(times), d8(12), d9(8) + HALF_HOUR)).toEqual([]);
  });

  it('accepts the aligned 3h step when it is the last step (events end at 20:00)', () => {
    const times = [d8(12), d8(13), d8(14), d8(15), d8(16), d8(17), d8(20)];
    expect(fundingGaps(realEvents(times), d8(12), d8(20) + HALF_HOUR)).toEqual([]);
  });

  it('flags a 3h step whose later event is off the 4h grid (18:00 -> 21:00)', () => {
    const times = [d8(12), d8(13), d8(14), d8(15), d8(16), d8(17), d8(18), d8(21), d9(1), d9(5)];
    expect(fundingGaps(realEvents(times), d8(12), d9(5) + HALF_HOUR)).toEqual([
      { reason: 'irregular_interval', after: d8(18), before: d8(21), hours: 3 },
    ]);
  });

  it('flags an on-grid 3h step followed by a 1h step instead of the 4h interval', () => {
    const times = [d8(12), d8(13), d8(14), d8(15), d8(16), d8(17), d8(20), d8(21)];
    expect(fundingGaps(realEvents(times), d8(12), d8(21) + HALF_HOUR)).toEqual([
      { reason: 'irregular_interval', after: d8(17), before: d8(20), hours: 3 },
    ]);
  });

  it('accepts a 6h step onto the 8h grid (10:00 -> 16:00, then 8h steps)', () => {
    const times = [d8(2), d8(6), d8(10), d8(16), d9(0), d9(8)];
    expect(fundingGaps(realEvents(times), d8(2), d9(8) + HALF_HOUR)).toEqual([]);
  });

  it('flags a 5h step off the 8h grid (04:00 -> 09:00)', () => {
    const times = [d8(0), d8(4), d8(9), d8(17), d9(1)];
    expect(fundingGaps(realEvents(times), d8(0), d9(1) + HALF_HOUR)).toEqual([
      { reason: 'irregular_interval', after: d8(4), before: d8(9), hours: 5 },
    ]);
  });
});
