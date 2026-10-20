import { Decimal } from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import type { Candle, FundingEvent } from '@cane/core';
import { BACKTEST_DEFAULTS, backtestSettings } from '../src/cli/funding-backtest.command.js';
import { FundingBacktestService, MAX_PARAMETER_SETS, parameterSets, type BacktestSettings, type FundingReader } from '../src/funding-backtest/funding-backtest.service.js';
import { formatBacktestReport, topSet } from '../src/funding-backtest/report.js';
import type { KlineCache } from '../src/market-data/kline-cache.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const FROM = Date.UTC(2025, 0, 1);
const DAYS = 30;
const TO = FROM + DAYS * DAY;
const d = (v: number | string) => new Decimal(v);

/** 8h settlements over the window; BTC pays 0.03% each time, ETH pays nothing until a hole. */
function funding(symbol: string): FundingEvent[] {
  const out: FundingEvent[] = [];
  for (let t = FROM; t < TO; t += 8 * HOUR) {
    if (symbol === 'ETHUSDT' && t === FROM + 10 * DAY) continue; // one missing event
    out.push({ fundingTime: t, rate: d(symbol === 'BTCUSDT' ? '0.0003' : '0.00001'), markPrice: null, intervalHours: 8 });
  }
  return out;
}

function candles(price: string): Candle[] {
  const out: Candle[] = [];
  for (let t = FROM; t < TO; t += HOUR) out.push({ openTime: t, closeTime: t + HOUR - 1, open: d(price), high: d(price), low: d(price), close: d(price), volume: d(1) });
  return out;
}

const reader: FundingReader = { range: vi.fn(async (symbol: string) => funding(symbol)) };
const klines = { closedCandles: vi.fn(async (market: string) => candles(market === 'spot' ? '100' : '100.1')) } as unknown as KlineCache;

const settings: BacktestSettings = {
  symbols: ['BTCUSDT', 'ETHUSDT'],
  from: FROM,
  to: TO,
  grid: { n: [3], entryAprMin: [d('0.05'), d('0.2'), d('0.5')], exitAprMin: [d(0)], k: [3], maxBreakevenDays: [d(10)] },
  costs: { spotFee: d('0.00075'), perpFee: d('0.00045'), slippage: d('0.0005') },
  leverage: 2,
  mmr: d('0.005'),
  bnbTrades: 10,
  notional: d(10000),
};

describe('FundingBacktestService (plan F02)', () => {
  it('runs every parameter set on every symbol and ranks by net APR of all symbols', async () => {
    const result = await new FundingBacktestService(klines, reader).run(settings);
    expect(klines.closedCandles).toHaveBeenCalledWith('spot', 'BTCUSDT', '1h', TO);
    expect(klines.closedCandles).toHaveBeenCalledWith('futures', 'ETHUSDT', '1h', TO);
    expect(result.sets).toHaveLength(3);
    // BTC pays 32.85% / yr: sets 1 (5%) and 2 (20%) trade it, set 3 (50%) never opens.
    expect(result.sets.map((s) => s.id)).toEqual([1, 2, 3]);
    const [best, , idle] = result.sets;
    expect(best!.symbols[0]!.result.pairs).toHaveLength(1);
    expect(best!.symbols[1]!.result.pairs).toHaveLength(0);
    expect(best!.all.netApr.gt(0)).toBe(true);
    expect(idle!.all.pairs).toBe(0);
    expect(idle!.all.netApr.toString()).toBe('0');
    expect(idle!.all.hurdleMet).toBe(false);
    // Capital per symbol: 10000 + 5000 + BNB buffer 240.
    expect(best!.all.capital.toString()).toBe('30480');
  });

  it('lists funding gaps per symbol', async () => {
    const result = await new FundingBacktestService(klines, reader).run(settings);
    expect(result.data.map((x) => x.gaps.map((g) => g.reason))).toEqual([[], ['irregular_interval']]);
    expect(result.data[0]).toMatchObject({ symbol: 'BTCUSDT', fundingRows: 90, spotCandles: DAYS * 24, perpCandles: DAYS * 24, missingCandles: 0 });
  });

  it('names the symbol when one cannot be simulated', async () => {
    const bad: FundingReader = { range: async (symbol: string) => funding(symbol).map((e) => ({ ...e, intervalHours: symbol === 'ETHUSDT' ? 0 : 8 })) };
    await expect(new FundingBacktestService(klines, bad).run(settings)).rejects.toThrow(/^ETHUSDT: fundingApr: interval must be > 0/);
  });

  it('refuses a grid above the set limit', async () => {
    const n = Array.from({ length: MAX_PARAMETER_SETS + 1 }, (_, i) => i + 1);
    expect(() => parameterSets({ ...settings.grid, entryAprMin: [d(0)], n })).toThrow(/1001 parameter sets/);
    await expect(new FundingBacktestService(klines, reader).run({ ...settings, grid: { ...settings.grid, entryAprMin: [d(0)], n } })).rejects.toThrow(/parameter sets/);
  });

  it('rejects an empty window', async () => {
    await expect(new FundingBacktestService(klines, reader).run({ ...settings, to: FROM })).rejects.toThrow(/window/);
  });
});

describe('formatBacktestReport', () => {
  it('has the data table, every set ranked and the pairs of the top set', async () => {
    const result = await new FundingBacktestService(klines, reader).run(settings);
    const md = formatBacktestReport(result, new Date('2026-10-19T00:00:00Z'));
    expect(md).toContain('# Funding-arb backtest');
    expect(md).toContain('Window: 2025-01-01 → 2025-01-31 (30.0 days)');
    expect(md).toContain('| BTCUSDT | 90 | 2025-01-01 00:00 | 2025-01-30 16:00 | 8h from 2025-01-01 | 0 | 720 | 720 | 0 |');
    expect(md).toContain('- ETHUSDT: irregular_interval, 2025-01-10 16:00 → 2025-01-11 08:00 (16h)');
    const setRows = md.split('\n').filter((l) => /^\| \d+ \| \d+ \|/.test(l));
    expect(setRows).toHaveLength(3);
    expect(setRows[2]).toContain('| 3 | 3 | 3 | 50.00 | 0.00 | 3 | 10 | All | 0 |');
    expect(md).toContain(`## Pairs of set ${topSet(result)!.id}`);
    expect(md).toMatch(/\| 1 \| BTCUSDT \| 2025-01-01 16:00 \| 2025-01-31 00:00 \| open \| window_end \|/);
    expect(md).toContain('### Margin stress');
  });

  it('says so when no pair opened', async () => {
    const result = await new FundingBacktestService(klines, reader).run({ ...settings, grid: { ...settings.grid, entryAprMin: [d(1)] } });
    expect(formatBacktestReport(result, new Date())).toContain('No pair opened.');
  });
});

describe('backtest CLI settings', () => {
  it('defaults to the plan F02 grid: 18 sets on BTC and ETH over 730 days', () => {
    const now = Date.UTC(2026, 9, 19);
    const s = backtestSettings({}, now);
    expect(s.symbols).toEqual(BACKTEST_DEFAULTS.symbols);
    expect(s.from).toBe(now - 730 * DAY);
    expect(parameterSets(s.grid)).toHaveLength(18);
    expect(s.grid.entryAprMin.map(String)).toEqual(['0.05', '0.1', '0.15']);
    expect(s.costs).toEqual({ spotFee: d('0.00075'), perpFee: d('0.00045'), slippage: d('0.0005') });
    expect(s.mmr.toString()).toBe('0.005');
  });

  it('turns percent options into fractions', () => {
    const s = backtestSettings({ entryApr: [d(8)], exitApr: [d('1.5')], perpFee: d('0.018'), days: 7 }, TO);
    expect(s.grid.entryAprMin.map(String)).toEqual(['0.08']);
    expect(s.grid.exitAprMin.map(String)).toEqual(['0.015']);
    expect(s.costs.perpFee.toString()).toBe('0.00018');
    expect(s.from).toBe(TO - 7 * DAY);
  });
});
