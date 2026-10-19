import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import {
  ARB_NET_APR_HURDLE,
  capitalUsed,
  fundingGaps,
  netApr,
  simulateArb,
  type ArbCosts,
  type ArbParams,
  type Candle,
  type FundingEvent,
  type FundingGap,
  type SimulateArbResult,
} from '@cane/core';
import { KlineCache } from '../market-data/kline-cache.js';

export const BACKTEST_FUNDING = Symbol('BACKTEST_FUNDING');

/** The read the backtest needs from `funding_rate` (the F01 `FundingStore`, on the read-only user). */
export interface FundingReader {
  range(symbol: string, from: number, to: number): Promise<FundingEvent[]>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Each list is one grid axis; every combination is one parameter set (plan F02 CLI). Rates are fractions. */
export interface BacktestGrid {
  n: number[];
  entryAprMin: Decimal[];
  exitAprMin: Decimal[];
  k: number[];
  maxBreakevenDays: Decimal[];
}

export interface BacktestSettings {
  symbols: string[];
  from: number;
  to: number;
  grid: BacktestGrid;
  costs: ArbCosts;
  leverage: number;
  mmr: Decimal;
  bnbTrades: number;
  notional: Decimal;
}

export interface SymbolData {
  symbol: string;
  fundingRows: number;
  first: number | null;
  last: number | null;
  intervals: { from: number; hours: number }[];
  gaps: FundingGap[];
  spotCandles: number;
  perpCandles: number;
  /** Settlements with no 1h candle on spot or perp. */
  missingCandles: number;
}

export interface SymbolRun {
  symbol: string;
  result: SimulateArbResult;
  capital: Decimal;
  netApr: Decimal;
  /** Share of the window spent in a pair (fraction). */
  inPair: Decimal;
}

export interface Totals {
  pairs: number;
  funding: Decimal;
  fees: Decimal;
  slippage: Decimal;
  basis: Decimal;
  net: Decimal;
  capital: Decimal;
  netApr: Decimal;
  inPair: Decimal;
  hurdleMet: boolean;
  worstMarginRatio: Decimal | null;
}

export interface SetRun {
  /** 1-based, in grid order (stable across runs with the same options). */
  id: number;
  params: ArbParams;
  symbols: SymbolRun[];
  all: Totals;
}

export interface BacktestResult {
  settings: BacktestSettings;
  days: Decimal;
  data: SymbolData[];
  /** Ranked by net APR of all symbols together, best first. */
  sets: SetRun[];
}

export function parameterSets(grid: BacktestGrid): ArbParams[] {
  const out: ArbParams[] = [];
  for (const n of grid.n)
    for (const entryAprMin of grid.entryAprMin)
      for (const exitAprMin of grid.exitAprMin)
        for (const k of grid.k)
          for (const maxBreakevenDays of grid.maxBreakevenDays) out.push({ n, entryAprMin, exitAprMin, k, maxBreakevenDays });
  return out;
}

function worst(values: Decimal[]): Decimal | null {
  return values.length === 0 ? null : Decimal.max(...values);
}

/**
 * Funding-arb backtest (plan F02): funding from `funding_rate` (read-only user),
 * 1h spot and USDⓈ-M klines from the public cache, rules from @cane/core.
 * No executor, no keys.
 */
@Injectable()
export class FundingBacktestService {
  constructor(
    private readonly klines: KlineCache,
    @Inject(BACKTEST_FUNDING) private readonly funding: FundingReader,
  ) {}

  async run(settings: BacktestSettings): Promise<BacktestResult> {
    const { from, to } = settings;
    if (to <= from) throw new Error('backtest: the window end must be after its start');
    if (settings.symbols.length === 0) throw new Error('backtest: no symbol given');
    const days = new Decimal(to - from).dividedBy(DAY_MS);
    const capital = capitalUsed(settings.notional, settings.leverage, settings.costs, settings.bnbTrades);

    const inputs: { symbol: string; events: FundingEvent[]; spot: Candle[]; perp: Candle[] }[] = [];
    const data: SymbolData[] = [];
    for (const symbol of settings.symbols) {
      const events = await this.funding.range(symbol, from, to);
      const inWindow = (c: Candle) => c.openTime >= from - HOUR_MS && c.closeTime < to;
      const spot = (await this.klines.closedCandles('spot', symbol, '1h', to)).filter(inWindow);
      const perp = (await this.klines.closedCandles('futures', symbol, '1h', to)).filter(inWindow);
      inputs.push({ symbol, events, spot, perp });
      data.push({
        symbol,
        fundingRows: events.length,
        first: events[0]?.fundingTime ?? null,
        last: events.at(-1)?.fundingTime ?? null,
        intervals: events
          .filter((e, i) => i === 0 || e.intervalHours !== events[i - 1]!.intervalHours)
          .map((e) => ({ from: e.fundingTime, hours: e.intervalHours })),
        gaps: fundingGaps(events, from, to),
        spotCandles: spot.length,
        perpCandles: perp.length,
        missingCandles: 0,
      });
    }

    const sets: SetRun[] = parameterSets(settings.grid).map((params, i) => {
      const symbols: SymbolRun[] = inputs.map(({ symbol, events, spot, perp }) => {
        const result =
          events.length === 0
            ? emptyResult()
            : simulateArb({ events, spot, perp, params, costs: settings.costs, notional: settings.notional, leverage: settings.leverage, mmr: settings.mmr, endTime: to });
        return { symbol, result, capital, netApr: netApr(result.net, capital, days), inPair: result.daysInPair.dividedBy(days) };
      });
      return { id: i + 1, params, symbols, all: totals(symbols, days) };
    });
    for (const [i, d] of data.entries()) d.missingCandles = sets[0]?.symbols[i]?.result.missingCandles ?? 0;

    sets.sort((a, b) => b.all.netApr.comparedTo(a.all.netApr) || a.id - b.id);
    return { settings, days, data, sets };
  }
}

function emptyResult(): SimulateArbResult {
  const zero = new Decimal(0);
  return { pairs: [], funding: zero, fees: zero, slippage: zero, basis: zero, net: zero, daysInPair: zero, missingCandles: 0 };
}

function totals(symbols: SymbolRun[], days: Decimal): Totals {
  const sum = (pick: (r: SimulateArbResult) => Decimal) => symbols.reduce((acc, s) => acc.plus(pick(s.result)), new Decimal(0));
  const capital = symbols.reduce((acc, s) => acc.plus(s.capital), new Decimal(0));
  const net = sum((r) => r.net);
  const apr = netApr(net, capital, days);
  return {
    pairs: symbols.reduce((acc, s) => acc + s.result.pairs.length, 0),
    funding: sum((r) => r.funding),
    fees: sum((r) => r.fees),
    slippage: sum((r) => r.slippage),
    basis: sum((r) => r.basis),
    net,
    capital,
    netApr: apr,
    inPair: symbols.reduce((acc, s) => acc.plus(s.inPair), new Decimal(0)).dividedBy(symbols.length),
    hurdleMet: apr.gte(ARB_NET_APR_HURDLE),
    worstMarginRatio: worst(symbols.flatMap((s) => s.result.pairs.map((p) => p.maxMarginRatio))),
  };
}

export function symbolTotals(run: SymbolRun): Totals {
  const r = run.result;
  return {
    pairs: r.pairs.length,
    funding: r.funding,
    fees: r.fees,
    slippage: r.slippage,
    basis: r.basis,
    net: r.net,
    capital: run.capital,
    netApr: run.netApr,
    inPair: run.inPair,
    hurdleMet: run.netApr.gte(ARB_NET_APR_HURDLE),
    worstMarginRatio: worst(r.pairs.map((p) => p.maxMarginRatio)),
  };
}
