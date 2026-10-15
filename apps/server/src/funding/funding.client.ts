import { Inject, Injectable, Optional } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { SettledFunding } from '@cane/core';
import { FETCH_FN, SLEEP_FN, type FetchFn } from '../market-data/klines.client.js';
import { publicGetJson } from '../market-data/public-get.js';

/** Public USDⓈ-M market data (funding-arb plan F01). Live endpoints even on Demo: Demo funding is not real. */
export const FAPI_BASE = 'https://fapi.binance.com';
export const FUNDING_PAGE_LIMIT = 1000;
const PAGE_DELAY_MS = 200;
const SYMBOL_RE = /^[A-Z0-9]{2,20}$/;

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

function assertSymbol(symbol: string): void {
  if (!SYMBOL_RE.test(symbol)) throw new Error(`Invalid symbol: ${symbol}`);
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
  ) {}

  private doSleep(ms: number): Promise<void> {
    if (this.sleep) return this.sleep(ms);
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private get(path: string, label: string): Promise<unknown> {
    return publicGetJson(this.fetchFn, (ms) => this.doSleep(ms), `${FAPI_BASE}${path}`, label);
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
    const r = body as Record<string, unknown>;
    if (r.symbol !== symbol) throw new Error(`premiumIndex returned ${JSON.stringify(r.symbol)} for ${symbol}`);
    return {
      symbol,
      markPrice: decimalString(r.markPrice, 'premiumIndex markPrice'),
      predictedRate: decimalString(r.lastFundingRate, 'premiumIndex lastFundingRate'),
      nextFundingTime: epochMs(r.nextFundingTime, 'nextFundingTime'),
      time: epochMs(r.time, 'premiumIndex time'),
    };
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
