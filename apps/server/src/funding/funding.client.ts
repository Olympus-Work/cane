import { Inject, Injectable, Optional } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { SettledFunding } from '@cane/core';
import type { PerpListing } from '@cane/core';
import { FETCH_FN, SLEEP_FN, SPOT_API_BASE, type FetchFn } from '../market-data/klines.client.js';
import { publicGetJson } from '../market-data/public-get.js';

/** Public USDⓈ-M market data (funding-arb plan F01). Live endpoints even on Demo: Demo funding is not real. */
export const FAPI_BASE = 'https://fapi.binance.com';
export const FUNDING_PAGE_LIMIT = 1000;
const PAGE_DELAY_MS = 200;
/** Binance symbol format; checked before a symbol goes into a URL or the DB. */
export const SYMBOL_RE = /^[A-Z0-9]{2,20}$/;
/** Nest token for the minimum spacing between requests (plan F01b pacing); unset = no pacing (tests). */
export const FUNDING_PACE_MS = Symbol('FUNDING_PACE_MS');
/** About 430 requests per 5 minutes: under the `/fapi/v1/fundingRate` limit of 500 per 5 minutes per IP. */
export const DEFAULT_FUNDING_PACE_MS = 700;
/** `settledAt` window on each side of a settlement time (funding times carry a few ms of offset). */
export const SETTLED_WINDOW_MS = 5 * 60_000;

/** `/fapi/v1/premiumIndex` for one symbol: the next funding and its predicted rate. */
export interface PremiumIndex {
  symbol: string;
  markPrice: Decimal;
  /** Predicted rate of the next settlement. */
  predictedRate: Decimal;
  nextFundingTime: number;
  time: number;
}

/** One `/fapi/v1/fundingInfo` row: only symbols whose interval or caps were adjusted are listed. */
export interface FundingInfo {
  symbol: string;
  fundingIntervalHours: number;
}

function decimalString(value: unknown, what: string): Decimal {
  if (typeof value !== 'string' || value === '' || Number.isNaN(Number(value))) {
    throw new Error(`Invalid ${what}: expected a decimal string, got ${JSON.stringify(value)}`);
  }
  return new Decimal(value);
}

function epochMs(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${what}: expected epoch ms, got ${JSON.stringify(value)}`);
  }
  return value;
}

/** Parse one `/fapi/v1/premiumIndex` object. */
function parsePremiumRow(raw: unknown): PremiumIndex {
  const r = raw as Record<string, unknown>;
  if (typeof r?.symbol !== 'string') throw new Error(`Invalid premiumIndex row: ${JSON.stringify(raw)}`);
  return {
    symbol: r.symbol,
    markPrice: decimalString(r.markPrice, 'premiumIndex markPrice'),
    predictedRate: decimalString(r.lastFundingRate, 'premiumIndex lastFundingRate'),
    nextFundingTime: epochMs(r.nextFundingTime, 'nextFundingTime'),
    time: epochMs(r.time, 'premiumIndex time'),
  };
}

export function assertSymbol(symbol: string, context = 'Invalid symbol'): void {
  if (!SYMBOL_RE.test(symbol)) throw new Error(`${context}: ${symbol}`);
}

/** Parse one `/fapi/v1/fundingRate` row. Old rows carry `markPrice: ""`. */
export function parseFundingRow(row: unknown): SettledFunding & { symbol: string } {
  if (typeof row !== 'object' || row === null) {
    throw new Error(`Invalid funding row: ${JSON.stringify(row)}`);
  }
  const r = row as Record<string, unknown>;
  if (typeof r.symbol !== 'string') throw new Error(`Invalid funding row symbol: ${JSON.stringify(r.symbol)}`);
  const markPrice = r.markPrice === undefined || r.markPrice === '' ? null : decimalString(r.markPrice, 'funding markPrice');
  return {
    symbol: r.symbol,
    fundingTime: epochMs(r.fundingTime, 'fundingTime'),
    rate: decimalString(r.fundingRate, 'fundingRate'),
    markPrice,
  };
}

@Injectable()
export class FundingClient {
  constructor(
    @Inject(FETCH_FN) private readonly fetchFn: FetchFn,
    @Optional() @Inject(SLEEP_FN) private readonly sleep?: (ms: number) => Promise<void>,
    @Optional() @Inject(FUNDING_PACE_MS) private readonly paceMs = 0,
  ) {}

  /** End of the previous request; every request waits until `paceMs` after it (one at a time per process). */
  private lastRequestAt = 0;

  private doSleep(ms: number): Promise<void> {
    if (this.sleep) return this.sleep(ms);
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private async get(path: string, label: string, base = FAPI_BASE): Promise<unknown> {
    const wait = this.lastRequestAt + this.paceMs - Date.now();
    if (this.paceMs > 0 && wait > 0) await this.doSleep(wait);
    try {
      return await publicGetJson(this.fetchFn, (ms) => this.doSleep(ms), `${base}${path}`, label);
    } finally {
      this.lastRequestAt = Date.now();
    }
  }

  /** Settled funding events with `from <= fundingTime <= to`, ascending, one per time. */
  async fundingHistory(symbol: string, from: number, to: number): Promise<SettledFunding[]> {
    assertSymbol(symbol);
    const byTime = new Map<number, SettledFunding>();
    let start = from;
    while (start <= to) {
      const body = await this.get(
        `/fapi/v1/fundingRate?symbol=${symbol}&startTime=${start}&endTime=${to}&limit=${FUNDING_PAGE_LIMIT}`,
        'Funding rate',
      );
      if (!Array.isArray(body)) {
        throw new Error(`Invalid fundingRate response: expected an array, got ${JSON.stringify(body)}`);
      }
      let last = -1;
      for (const raw of body) {
        const row = parseFundingRow(raw);
        if (row.symbol !== symbol) throw new Error(`fundingRate returned ${row.symbol} for ${symbol}`);
        byTime.set(row.fundingTime, { fundingTime: row.fundingTime, rate: row.rate, markPrice: row.markPrice });
        last = Math.max(last, row.fundingTime);
      }
      if (body.length < FUNDING_PAGE_LIMIT) break;
      start = last + 1;
      await this.doSleep(PAGE_DELAY_MS);
    }
    return [...byTime.values()].sort((a, b) => a.fundingTime - b.fundingTime);
  }

  async premiumIndex(symbol: string): Promise<PremiumIndex> {
    assertSymbol(symbol);
    const body = await this.get(`/fapi/v1/premiumIndex?symbol=${symbol}`, 'Premium index');
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new Error(`Invalid premiumIndex response: ${JSON.stringify(body)}`);
    }
    const r = parsePremiumRow(body);
    if (r.symbol !== symbol) throw new Error(`premiumIndex returned ${JSON.stringify(r.symbol)} for ${symbol}`);
    return r;
  }

  /** Every symbol's next funding time and predicted rate: one `/fapi/v1/premiumIndex` call without a symbol (plan F01b). */
  async premiumIndexAll(): Promise<PremiumIndex[]> {
    const body = await this.get('/fapi/v1/premiumIndex', 'Premium index');
    if (!Array.isArray(body)) {
      throw new Error(`Invalid premiumIndex response: expected an array, got ${JSON.stringify(body)}`);
    }
    return body.map(parsePremiumRow);
  }

  /**
   * Every symbol's settled event within ±5 minutes of `slot`: one
   * `/fapi/v1/fundingRate` call without a symbol (plan F01b). Returns null when
   * the page is full (1000 rows): it may be truncated and is never taken as complete.
   */
  async settledAt(slot: number): Promise<Array<SettledFunding & { symbol: string }> | null> {
    const from = slot - SETTLED_WINDOW_MS;
    const to = slot + SETTLED_WINDOW_MS;
    const body = await this.get(`/fapi/v1/fundingRate?startTime=${from}&endTime=${to}&limit=${FUNDING_PAGE_LIMIT}`, 'Funding rate');
    if (!Array.isArray(body)) {
      throw new Error(`Invalid fundingRate response: expected an array, got ${JSON.stringify(body)}`);
    }
    if (body.length >= FUNDING_PAGE_LIMIT) return null;
    return body.map(parseFundingRow).filter((r) => r.fundingTime >= from && r.fundingTime <= to);
  }

  /** USDⓈ-M symbols from `/fapi/v1/exchangeInfo`, with the fields the candidate filter reads (plan F01b). */
  async perpListings(): Promise<PerpListing[]> {
    const body = await this.get('/fapi/v1/exchangeInfo', 'Futures exchange info');
    const symbols = (body as { symbols?: unknown } | null)?.symbols;
    if (!Array.isArray(symbols)) throw new Error('Invalid futures exchangeInfo response: no symbols array');
    return symbols.map((raw) => {
      const r = raw as Record<string, unknown>;
      if (
        typeof r?.symbol !== 'string' ||
        typeof r.contractType !== 'string' ||
        typeof r.status !== 'string' ||
        typeof r.quoteAsset !== 'string'
      ) {
        throw new Error(`Invalid futures exchangeInfo symbol: ${JSON.stringify(r?.symbol)}`);
      }
      return {
        symbol: r.symbol,
        contractType: r.contractType,
        status: r.status,
        quoteAsset: r.quoteAsset,
        onboardDate: epochMs(r.onboardDate, `onboardDate of ${r.symbol}`),
      };
    });
  }

  /** Spot symbols with status TRADING (`/api/v3/exchangeInfo?symbolStatus=TRADING`, plan F01b). */
  async spotSymbols(): Promise<Set<string>> {
    const body = await this.get('/api/v3/exchangeInfo?symbolStatus=TRADING', 'Spot exchange info', SPOT_API_BASE);
    const symbols = (body as { symbols?: unknown } | null)?.symbols;
    if (!Array.isArray(symbols)) throw new Error('Invalid spot exchangeInfo response: no symbols array');
    const out = new Set<string>();
    for (const raw of symbols) {
      const r = raw as Record<string, unknown>;
      if (typeof r?.symbol !== 'string' || typeof r.status !== 'string') {
        throw new Error(`Invalid spot exchangeInfo symbol: ${JSON.stringify(r?.symbol)}`);
      }
      if (r.status === 'TRADING') out.add(r.symbol);
    }
    return out;
  }

  /** Symbols with an adjusted interval or caps. A symbol missing here uses the exchange default. */
  async fundingInfo(): Promise<FundingInfo[]> {
    const body = await this.get('/fapi/v1/fundingInfo', 'Funding info');
    if (!Array.isArray(body)) {
      throw new Error(`Invalid fundingInfo response: expected an array, got ${JSON.stringify(body)}`);
    }
    return body.map((raw) => {
      const r = raw as Record<string, unknown>;
      if (typeof r?.symbol !== 'string' || typeof r.fundingIntervalHours !== 'number') {
        throw new Error(`Invalid fundingInfo row: ${JSON.stringify(raw)}`);
      }
      return { symbol: r.symbol, fundingIntervalHours: r.fundingIntervalHours };
    });
  }
}
