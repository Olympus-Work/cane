import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  arbEntry,
  arbExit,
  avgFundingApr,
  breakevenDays,
  capitalUsed,
  netApr,
  roundTripCostPct,
  shortMarginRatio,
  simulateArb,
  type ArbCosts,
  type ArbParams,
  type SimulateArbInput,
} from '../src/funding/arb.js';
import { HOUR_MS, type FundingEvent } from '../src/funding/funding.js';
import type { Candle } from '../src/types.js';

const d = (v: number | string) => new Decimal(v);
const T0 = Date.UTC(2024, 0, 1);

function events(rates: (number | string)[], intervalHours = 8, markPrice: string | null = null): FundingEvent[] {
  return rates.map((r, i) => ({
    fundingTime: T0 + i * intervalHours * HOUR_MS,
    rate: d(r),
    markPrice: markPrice === null ? null : d(markPrice),
    intervalHours,
  }));
}

/** 1h candles from T0 at a flat price; `highs` overrides the high of given hours. */
function hourly(hours: number, price: number | string, highs: Record<number, number | string> = {}): Candle[] {
  return Array.from({ length: hours }, (_, h) => {
    const openTime = T0 + h * HOUR_MS;
    const p = d(price);
    return { openTime, closeTime: openTime + HOUR_MS - 1, open: p, high: d(highs[h] ?? price), low: p, close: p, volume: d(1) };
  });
}

const params: ArbParams = { n: 3, entryAprMin: d('0.1'), exitAprMin: d('0'), k: 2, maxBreakevenDays: d(10) };
const costs: ArbCosts = { spotFee: d('0.001'), perpFee: d('0.0005'), slippage: d('0.001') };

describe('avgFundingApr (B4)', () => {
  it('is null until N events exist', () => {
    expect(avgFundingApr(events([0.0001, 0.0001]), 3)).toBeNull();
  });

  it('averages each event at its own interval (B2, B3)', () => {
    const mixed: FundingEvent[] = [...events([0.0001], 8), ...events([0.0001], 4).map((e) => ({ ...e, fundingTime: T0 + 8 * HOUR_MS }))];
    expect(avgFundingApr(mixed, 2)!.toString()).toBe('0.16425');
  });

  it('uses only the last N events', () => {
    expect(avgFundingApr(events([-0.01, 0.0001, 0.0001]), 2)!.toString()).toBe('0.1095');
  });
});

describe('round trip cost and break-even (B5, B6)', () => {
  it('is 2 × spot + 2 × perp + slippage', () => {
    expect(roundTripCostPct(costs).toString()).toBe('0.004');
  });

  it('break-even days = cost / daily funding; null when funding does not pay', () => {
    expect(breakevenDays(d('0.004'), d('0.146'))!.toString()).toBe('10');
    expect(breakevenDays(d('0.004'), d(0))).toBeNull();
    expect(breakevenDays(d('0.004'), d('-0.1'))).toBeNull();
  });
});

describe('arbEntry (B4, B5)', () => {
  it('waits for N settled events', () => {
    expect(arbEntry(events([0.001, 0.001]), params, costs)).toMatchObject({ open: false, reason: 'warming_up' });
  });

  it('opens when the average, the last rate and the break-even all pass', () => {
    const r = arbEntry(events([0.0002, 0.0002, 0.0002]), params, costs);
    expect(r.open).toBe(true);
    expect(r.reason).toBe('open');
    expect(r.avgApr!.toString()).toBe('0.219');
  });

  it('blocks below the entry APR', () => {
    expect(arbEntry(events([0.00005, 0.00005, 0.00005]), params, costs).reason).toBe('below_entry_apr');
  });

  it('blocks when the last settled rate is not positive', () => {
    expect(arbEntry(events([0.0005, 0.0005, 0]), params, costs).reason).toBe('last_rate_not_positive');
  });

  it('blocks when the round trip takes longer than max_breakeven_days', () => {
    const r = arbEntry(events([0.0001, 0.0001, 0.0001]), { ...params, entryAprMin: d(0) }, costs);
    expect(r.reason).toBe('breakeven_too_long');
    expect(r.breakevenDays!.toDecimalPlaces(2).toString()).toBe('13.33');
  });
});

describe('arbExit (B14)', () => {
  it('holds while the average stays at or above the exit APR', () => {
    expect(arbExit(events([0.0001, 0.0001, 0.0001]), params)).toMatchObject({ close: false, reason: 'hold' });
  });

  it('exits below the exit APR', () => {
    expect(arbExit(events([0.0001, -0.0003, 0.0001]), params).reason).toBe('below_exit_apr');
  });

  it('exits after K negative rates in a row even with a positive average', () => {
    const r = arbExit(events([0.001, -0.0001, -0.0001]), params);
    expect(r.avgApr!.gt(0)).toBe(true);
    expect(r.reason).toBe('negative_k');
  });
});

describe('capital and net APR (B23, B26)', () => {
  it('capital used = notional + margin + BNB buffer of both wallets', () => {
    const c: ArbCosts = { spotFee: d('0.00075'), perpFee: d('0.00045'), slippage: d(0) };
    expect(capitalUsed(d(10000), 2, c, 10).toString()).toBe('15240');
  });

  it('net APR annualises net PnL on capital used', () => {
    expect(netApr(d('152.4'), d(15240), 365).toString()).toBe('0.01');
    expect(netApr(d(10), d(1000), 73).toString()).toBe('0.05');
  });

  it('rejects zero capital or days', () => {
    expect(() => netApr(d(1), d(0), 1)).toThrow();
    expect(() => netApr(d(1), d(1), 0)).toThrow();
  });
});

describe('shortMarginRatio (B17 evidence)', () => {
  it('is maintenance over balance, capped at 100% when the margin is gone', () => {
    expect(shortMarginRatio(d(1), d(100), d(100), 2, d('0.005')).toString()).toBe('0.01');
    expect(shortMarginRatio(d(1), d(100), d(140), 2, d('0.005')).toString()).toBe('0.07');
    expect(shortMarginRatio(d(1), d(100), d(150), 2, d('0.005')).toString()).toBe('1');
  });
});

describe('simulateArb (plan F02 model)', () => {
  // 3 warm-up settlements, then 2 paid, then 2 negatives (K = 2) → exit.
  const rates = [0.0002, 0.0002, 0.0002, 0.0002, 0.0002, -0.0001, -0.0001, 0.0002];
  const hours = rates.length * 8 + 1;
  const base = (over: Partial<SimulateArbInput> = {}): SimulateArbInput => ({
    events: events(rates),
    spot: hourly(hours, 100),
    perp: hourly(hours, '100.5', { 20: 110 }),
    params,
    costs,
    notional: d(10000),
    leverage: 2,
    mmr: d('0.005'),
    endTime: T0 + hours * HOUR_MS,
    ...over,
  });

  it('opens at the Nth settlement, earns the later ones and exits on K negatives', () => {
    const r = simulateArb(base());
    expect(r.pairs).toHaveLength(1);
    const p = r.pairs[0]!;
    expect(p.openTime).toBe(T0 + 16 * HOUR_MS);
    expect(p.closeTime).toBe(T0 + 48 * HOUR_MS);
    expect(p.exitReason).toBe('negative_k');
    expect(p.status).toBe('closed');
    expect(p.qty.toString()).toBe('100');
    // 4 settlements earned: 0.0002 × 2 − 0.0001 × 2 = 0.0002 of qty × perp price.
    expect(p.settlements).toBe(4);
    expect(p.funding.toString()).toBe('2.01');
    // spot 10000 × 0.001 × 2 + perp 10050 × 0.0005 × 2
    expect(p.fees.toString()).toBe('30.05');
    expect(p.slippage.toString()).toBe('10');
    expect(p.basis.toString()).toBe('0');
    expect(p.net.toString()).toBe('-38.04');
    expect(p.maxAdverseMove.toDecimalPlaces(6).toString()).toBe('0.094527');
    expect(r.net.toString()).toBe('-38.04');
    expect(r.daysInPair.toString()).toBe('1.3333333333333333333');
    expect(r.missingCandles).toBe(0);
  });

  it('pays funding on the settlement mark price when the row has one', () => {
    const r = simulateArb(base({ events: events(rates, 8, '101') }));
    expect(r.pairs[0]!.funding.toString()).toBe('2.02');
  });

  it('a pair open at the window end is marked at the last close and flagged', () => {
    const r = simulateArb(base({ events: events(rates.slice(0, 5)) }));
    const p = r.pairs[0]!;
    expect(p.status).toBe('open');
    expect(p.exitReason).toBe('window_end');
    expect(p.closeTime).toBe(T0 + hours * HOUR_MS);
    expect(p.settlements).toBe(2);
  });

  it('exits on the exit APR', () => {
    const r = simulateArb(base({ params: { ...params, exitAprMin: d('0.2') } }));
    expect(r.pairs[0]!.exitReason).toBe('below_exit_apr');
    expect(r.pairs[0]!.closeTime).toBe(T0 + 40 * HOUR_MS);
  });

  it('counts basis PnL from both legs', () => {
    const spot = hourly(hours, 100).map((c) => (c.openTime >= T0 + 48 * HOUR_MS ? { ...c, open: d(110), close: d(110) } : c));
    const perp = hourly(hours, '100.5').map((c) => (c.openTime >= T0 + 48 * HOUR_MS ? { ...c, open: d(110), close: d(110) } : c));
    const p = simulateArb(base({ spot, perp })).pairs[0]!;
    // spot +10 × 100, perp short −9.5 × 100
    expect(p.basis.toString()).toBe('50');
  });

  it('makes no decision at a settlement without a candle', () => {
    const spot = hourly(hours, 100).filter((c) => c.openTime !== T0 + 16 * HOUR_MS);
    const r = simulateArb(base({ spot }));
    expect(r.missingCandles).toBe(1);
    expect(r.pairs[0]!.openTime).toBe(T0 + 24 * HOUR_MS);
  });

  it('opens nothing when the break-even is too long', () => {
    const r = simulateArb(base({ params: { ...params, maxBreakevenDays: d(1) } }));
    expect(r.pairs).toEqual([]);
    expect(r.net.toString()).toBe('0');
  });
});
