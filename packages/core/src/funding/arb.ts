import { Decimal } from 'decimal.js';
import type { Candle } from '../types.js';
import { HOUR_MS, fundingApr, type FundingEvent } from './funding.js';

const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60 * 1000;
const ZERO = new Decimal(0);

/** spec B27.5: the net APR (B26) the strategy must reach to be worth running, 6% / yr (owner, 2026-10-14). */
export const ARB_NET_APR_HURDLE = new Decimal('0.06');

/** Entry / exit thresholds of the funding-arb strategy (spec B4, B5, B14). Rates are fractions (0.1 = 10% / yr). */
export interface ArbParams {
  /** N: settled intervals in the funding average. */
  n: number;
  entryAprMin: Decimal;
  exitAprMin: Decimal;
  /** K: consecutive negative settled rates that force an exit. */
  k: number;
  maxBreakevenDays: Decimal;
}

/** Fee rates per fill and the round-trip slippage allowance, as fractions of one leg's notional (spec B6). */
export interface ArbCosts {
  spotFee: Decimal;
  perpFee: Decimal;
  slippage: Decimal;
}

function assertParams(p: ArbParams): void {
  if (!Number.isInteger(p.n) || p.n < 1) throw new Error(`arb: N must be a whole number >= 1, got ${p.n}`);
  if (!Number.isInteger(p.k) || p.k < 1) throw new Error(`arb: K must be a whole number >= 1, got ${p.k}`);
}

/** Mean funding APR over the last `n` settled events (spec B4); null with fewer than `n`. */
export function avgFundingApr(events: readonly FundingEvent[], n: number): Decimal | null {
  if (!Number.isInteger(n) || n < 1) throw new Error(`avgFundingApr: n must be a whole number >= 1, got ${n}`);
  if (events.length < n) return null;
  let sum = ZERO;
  for (let i = events.length - n; i < events.length; i++) {
    const e = events[i]!;
    sum = sum.plus(fundingApr(e.rate, e.intervalHours));
  }
  return sum.dividedBy(n);
}

/** spec B6: 2 × spot fee + 2 × perp fee + slippage allowance, as a fraction of one leg's notional. */
export function roundTripCostPct(costs: ArbCosts): Decimal {
  return costs.spotFee.times(2).plus(costs.perpFee.times(2)).plus(costs.slippage);
}

/** spec B5: days of average funding needed to pay the round trip; null when funding does not pay (avg APR <= 0). */
export function breakevenDays(costPct: Decimal, avgApr: Decimal): Decimal | null {
  if (avgApr.lte(0)) return null;
  return costPct.dividedBy(avgApr.dividedBy(365));
}

export type ArbEntryReason = 'open' | 'warming_up' | 'below_entry_apr' | 'last_rate_not_positive' | 'breakeven_too_long';

export interface ArbEntryDecision {
  open: boolean;
  reason: ArbEntryReason;
  avgApr: Decimal | null;
  breakevenDays: Decimal | null;
}

/**
 * spec B4 + B5 for one symbol with no open pair. `history` ends with the latest
 * settled event. Whitelist, enable and needs_attention checks belong to the caller.
 */
export function arbEntry(history: readonly FundingEvent[], params: ArbParams, costs: ArbCosts): ArbEntryDecision {
  assertParams(params);
  const avgApr = avgFundingApr(history, params.n);
  if (avgApr === null) return { open: false, reason: 'warming_up', avgApr, breakevenDays: null };
  const days = breakevenDays(roundTripCostPct(costs), avgApr);
  const decision = (open: boolean, reason: ArbEntryReason): ArbEntryDecision => ({ open, reason, avgApr, breakevenDays: days });
  if (avgApr.lt(params.entryAprMin)) return decision(false, 'below_entry_apr');
  if (!history.at(-1)!.rate.gt(0)) return decision(false, 'last_rate_not_positive');
  if (days === null || days.gt(params.maxBreakevenDays)) return decision(false, 'breakeven_too_long');
  return decision(true, 'open');
}

export type ArbExitReason = 'hold' | 'below_exit_apr' | 'negative_k';

export interface ArbExitDecision {
  close: boolean;
  reason: ArbExitReason;
  avgApr: Decimal | null;
}

/** spec B14 for an open pair. `history` ends with the latest settled event. */
export function arbExit(history: readonly FundingEvent[], params: ArbParams): ArbExitDecision {
  assertParams(params);
  const avgApr = avgFundingApr(history, params.n);
  if (avgApr !== null && avgApr.lt(params.exitAprMin)) return { close: true, reason: 'below_exit_apr', avgApr };
  if (history.length >= params.k && history.slice(-params.k).every((e) => e.rate.lt(0))) {
    return { close: true, reason: 'negative_k', avgApr };
  }
  return { close: false, reason: 'hold', avgApr };
}

/**
 * spec B26 capital used: spot notional + perp margin + the BNB buffer of both
 * wallets (B23: `bnbTrades` round trips × 2 fills × notional × that wallet's fee).
 */
export function capitalUsed(notional: Decimal, leverage: number, costs: ArbCosts, bnbTrades: number): Decimal {
  if (!(leverage > 0)) throw new Error(`capitalUsed: leverage must be > 0, got ${leverage}`);
  const buffer = notional.times(2 * bnbTrades).times(costs.spotFee.plus(costs.perpFee));
  return notional.plus(notional.dividedBy(leverage)).plus(buffer);
}

/** spec B26 net APR on capital used, as a fraction per year. */
export function netApr(netPnl: Decimal, capital: Decimal, days: Decimal | number): Decimal {
  const d = new Decimal(days);
  if (!capital.gt(0) || !d.gt(0)) throw new Error('netApr: capital and days must be > 0');
  return netPnl.dividedBy(capital).times(365).dividedBy(d);
}

/**
 * Worst perp margin ratio of a short at `price` (spec B17 evidence): maintenance
 * margin over margin balance, isolated, funding not counted. 1 (100%) or more
 * means the margin is gone; the result is capped at 1.
 */
export function shortMarginRatio(qty: Decimal, entry: Decimal, price: Decimal, leverage: number, mmr: Decimal): Decimal {
  const balance = qty.times(entry).dividedBy(leverage).plus(qty.times(entry.minus(price)));
  if (balance.lte(0)) return new Decimal(1);
  return Decimal.min(1, qty.times(price).times(mmr).dividedBy(balance));
}

export interface SimulateArbInput {
  /** Settled funding of one symbol inside the window, ascending. */
  events: readonly FundingEvent[];
  /** 1h closed candles of the spot and USDⓈ-M markets, ascending. */
  spot: readonly Candle[];
  perp: readonly Candle[];
  params: ArbParams;
  costs: ArbCosts;
  /** Notional of each leg at entry (USDT). */
  notional: Decimal;
  leverage: number;
  /** Maintenance margin rate of the perp leg. */
  mmr: Decimal;
  /** Window end (UTC ms): a pair still open is marked to market at the last 1h close before it. */
  endTime: number;
}

export interface ArbPairResult {
  openTime: number;
  closeTime: number;
  status: 'closed' | 'open';
  exitReason: Exclude<ArbExitReason, 'hold'> | 'window_end';
  entryAvgApr: Decimal;
  entryBreakevenDays: Decimal;
  qty: Decimal;
  spotEntry: Decimal;
  perpEntry: Decimal;
  spotExit: Decimal;
  perpExit: Decimal;
  /** Settlements earned while open. */
  settlements: number;
  funding: Decimal;
  fees: Decimal;
  slippage: Decimal;
  /** Spot PnL + perp PnL excluding funding (B26). */
  basis: Decimal;
  net: Decimal;
  /** Highest perp 1h high over the perp entry, minus 1 (fraction). */
  maxAdverseMove: Decimal;
  maxMarginRatio: Decimal;
}

export interface SimulateArbResult {
  pairs: ArbPairResult[];
  funding: Decimal;
  fees: Decimal;
  slippage: Decimal;
  basis: Decimal;
  net: Decimal;
  daysInPair: Decimal;
  /** Settlements in the window with no 1h candle on spot or perp (no decision there). */
  missingCandles: number;
}

function hourOf(timeMs: number): number {
  const minute = Math.round(timeMs / MINUTE_MS) * MINUTE_MS;
  return Math.floor(minute / HOUR_MS) * HOUR_MS;
}

function lastCloseBefore(candles: readonly Candle[], endTime: number): Candle | undefined {
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i]!.closeTime < endTime) return candles[i];
  }
  return undefined;
}

interface OpenPair {
  openTime: number;
  entryAvgApr: Decimal;
  entryBreakevenDays: Decimal;
  qty: Decimal;
  spotEntry: Decimal;
  perpEntry: Decimal;
  settlements: number;
  funding: Decimal;
  fees: Decimal;
  slippage: Decimal;
}

/**
 * Funding-arb backtest of one symbol (funding-arb plan F02 "Model"). Decides at
 * every settlement: an open pair earns that settlement and may exit (B14); a
 * flat symbol may open (B4, B5) at the 1h opens of that hour and earns from the
 * next settlement on. Pure: everything it needs is in `input`.
 */
export function simulateArb(input: SimulateArbInput): SimulateArbResult {
  const { events, params, costs, notional, leverage, mmr } = input;
  assertParams(params);
  const spotByHour = new Map(input.spot.map((c) => [c.openTime, c]));
  const perpIndex = new Map(input.perp.map((c, i) => [c.openTime, i]));
  const lookback = Math.max(params.n, params.k);
  const halfSlip = costs.slippage.dividedBy(2);

  const pairs: ArbPairResult[] = [];
  let open: OpenPair | null = null;
  let lastPerp: Decimal | null = null;
  let missingCandles = 0;

  const close = (o: OpenPair, closeTime: number, spotExit: Decimal, perpExit: Decimal, exitReason: ArbPairResult['exitReason']): void => {
    const fees = o.fees.plus(o.qty.times(spotExit).times(costs.spotFee)).plus(o.qty.times(perpExit).times(costs.perpFee));
    const slippage = o.slippage.plus(o.qty.times(spotExit).times(halfSlip));
    const basis = o.qty.times(spotExit.minus(o.spotEntry)).plus(o.qty.times(o.perpEntry.minus(perpExit)));
    let maxHigh = o.perpEntry;
    const from = perpIndex.get(hourOf(o.openTime));
    if (from !== undefined) {
      for (let i = from; i < input.perp.length && input.perp[i]!.openTime < closeTime; i++) {
        maxHigh = Decimal.max(maxHigh, input.perp[i]!.high);
      }
    }
    pairs.push({
      openTime: o.openTime,
      closeTime,
      status: exitReason === 'window_end' ? 'open' : 'closed',
      exitReason,
      entryAvgApr: o.entryAvgApr,
      entryBreakevenDays: o.entryBreakevenDays,
      qty: o.qty,
      spotEntry: o.spotEntry,
      perpEntry: o.perpEntry,
      spotExit,
      perpExit,
      settlements: o.settlements,
      funding: o.funding,
      fees,
      slippage,
      basis,
      net: o.funding.minus(fees).minus(slippage).plus(basis),
      maxAdverseMove: maxHigh.dividedBy(o.perpEntry).minus(1),
      maxMarginRatio: shortMarginRatio(o.qty, o.perpEntry, maxHigh, leverage, mmr),
    });
  };

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const hour = hourOf(e.fundingTime);
    const spotBar = spotByHour.get(hour);
    const perpAt = perpIndex.get(hour);
    const perpBar = perpAt === undefined ? undefined : input.perp[perpAt];
    if (perpBar) lastPerp = perpBar.open;
    const history = events.slice(Math.max(0, i + 1 - lookback), i + 1);
    if (!spotBar || !perpBar) missingCandles++;

    if (open) {
      const mark = e.markPrice ?? perpBar?.open ?? lastPerp;
      if (mark) {
        open.funding = open.funding.plus(open.qty.times(mark).times(e.rate));
        open.settlements++;
      }
      const exit = arbExit(history, params);
      if (exit.close && spotBar && perpBar) {
        close(open, hour, spotBar.open, perpBar.open, exit.reason as Exclude<ArbExitReason, 'hold'>);
        open = null;
      }
      continue;
    }

    if (!spotBar || !perpBar) continue;
    const entry = arbEntry(history, params, costs);
    if (!entry.open) continue;
    const qty = notional.dividedBy(spotBar.open);
    open = {
      openTime: hour,
      entryAvgApr: entry.avgApr!,
      entryBreakevenDays: entry.breakevenDays!,
      qty,
      spotEntry: spotBar.open,
      perpEntry: perpBar.open,
      settlements: 0,
      funding: ZERO,
      fees: qty.times(spotBar.open).times(costs.spotFee).plus(qty.times(perpBar.open).times(costs.perpFee)),
      slippage: qty.times(spotBar.open).times(halfSlip),
    };
  }

  if (open) {
    const spotLast = lastCloseBefore(input.spot, input.endTime);
    const perpLast = lastCloseBefore(input.perp, input.endTime);
    if (!spotLast || !perpLast) throw new Error('simulateArb: no candle to mark the open pair at the window end');
    close(open, Math.max(spotLast.closeTime, perpLast.closeTime) + 1, spotLast.close, perpLast.close, 'window_end');
  }

  const sum = (pick: (p: ArbPairResult) => Decimal) => pairs.reduce((acc, p) => acc.plus(pick(p)), ZERO);
  return {
    pairs,
    funding: sum((p) => p.funding),
    fees: sum((p) => p.fees),
    slippage: sum((p) => p.slippage),
    basis: sum((p) => p.basis),
    net: sum((p) => p.net),
    daysInPair: pairs.reduce((acc, p) => acc.plus(new Decimal(p.closeTime - p.openTime).dividedBy(DAY_MS)), ZERO),
    missingCandles,
  };
}
