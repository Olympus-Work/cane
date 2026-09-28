import { Inject, Injectable, Optional } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { Candle, Timeframe } from '@cane/core';

export type KlineMarket = 'spot' | 'futures';

export const KLINES_URL: Record<KlineMarket, string> = {
  spot: 'https://api.binance.com/api/v3/klines',
  futures: 'https://fapi.binance.com/fapi/v1/klines',
};

export const KLINES_PAGE_LIMIT: Record<KlineMarket, number> = {
  spot: 1000,
  futures: 1500,
};

/** Nest injection token for a fetch-compatible function (public market data only). */
export const FETCH_FN = Symbol('FETCH_FN');

/** Nest injection token for a sleep function (injectable for tests). */
export const SLEEP_FN = Symbol('SLEEP_FN');

export type FetchFn = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

const SYMBOL_RE = /^[A-Z0-9]{2,20}$/;
const MAX_ATTEMPTS = 5;
const PAGE_DELAY_MS = 200;

function isDecimalString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Number(value));
}

/**
 * Parse one Binance kline array:
 * [openTime, open, high, low, close, volume, closeTime, ...].
 * Prices and volume are decimal strings; times are epoch milliseconds.
 */
export function parseKline(row: unknown): Candle {
  if (!Array.isArray(row) || row.length < 7) {
    throw new Error(
      `Invalid kline row: expected an array of at least 7 items, got ${JSON.stringify(row)}`,
    );
  }
  const [openTime, open, high, low, close, volume, closeTime] = row;
  if (typeof openTime !== 'number' || !Number.isFinite(openTime)) {
    throw new Error(`Invalid kline row: openTime must be a number, got ${JSON.stringify(openTime)}`);
  }
  if (typeof closeTime !== 'number' || !Number.isFinite(closeTime)) {
    throw new Error(`Invalid kline row: closeTime must be a number, got ${JSON.stringify(closeTime)}`);
  }
  for (const [name, value] of [
    ['open', open],
    ['high', high],
    ['low', low],
    ['close', close],
    ['volume', volume],
  ] as const) {
    if (!isDecimalString(value)) {
      throw new Error(`Invalid kline row: ${name} must be a decimal string, got ${JSON.stringify(value)}`);
    }
  }
  return {
    openTime,
    closeTime,
    open: new Decimal(open),
    high: new Decimal(high),
    low: new Decimal(low),
    close: new Decimal(close),
    volume: new Decimal(volume),
  };
}

@Injectable()
export class KlinesClient {
  constructor(
    @Inject(FETCH_FN) private readonly fetchFn: FetchFn,
    @Optional() @Inject(SLEEP_FN) private readonly sleep?: (ms: number) => Promise<void>,
  ) {}

  private async doSleep(ms: number): Promise<void> {
    if (this.sleep) {
      await this.sleep(ms);
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  async fetchRange(
    market: KlineMarket,
    symbol: string,
    interval: Timeframe,
    startTime: number,
    endTime: number,
  ): Promise<Candle[]> {
    if (!SYMBOL_RE.test(symbol)) {
      throw new Error(`Invalid symbol: ${symbol}`);
    }
    const limit = KLINES_PAGE_LIMIT[market];
    const candles: Candle[] = [];
    let start = startTime;

    while (true) {
      const url =
        `${KLINES_URL[market]}?symbol=${symbol}&interval=${interval}` +
        `&startTime=${start}&endTime=${endTime}&limit=${limit}`;
      const rows = await this.fetchPage(url);
      for (const row of rows) {
        candles.push(parseKline(row));
      }
      if (rows.length === 0 || rows.length < limit) {
        break;
      }
      const last = rows[rows.length - 1];
      if (!Array.isArray(last) || typeof last[0] !== 'number') {
        throw new Error('Invalid kline row: openTime must be a number');
      }
      start = last[0] + 1;
      if (start > endTime) {
        break;
      }
      await this.doSleep(PAGE_DELAY_MS);
    }

    const byOpenTime = new Map<number, Candle>();
    for (const candle of candles) {
      byOpenTime.set(candle.openTime, candle);
    }
    return [...byOpenTime.values()].sort((a, b) => a.openTime - b.openTime);
  }

  private async fetchPage(url: string): Promise<unknown[]> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const res = await this.fetchFn(url, { method: 'GET' });
      if (res.ok) {
        const body = await res.json();
        if (!Array.isArray(body)) {
          throw new Error(`Invalid klines response: expected an array, got ${JSON.stringify(body)}`);
        }
        return body;
      }
      if (res.status !== 429 && res.status !== 418 && res.status < 500) {
        throw new Error(`Klines request failed with status ${res.status}`);
      }
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(`Klines request failed after ${MAX_ATTEMPTS} attempts with status ${res.status}`);
      }
      const retryAfter = res.headers.get('Retry-After');
      const delayMs =
        retryAfter !== null && retryAfter !== '' && !Number.isNaN(Number(retryAfter))
          ? Number(retryAfter) * 1000
          : 1000 * 2 ** (attempt - 1);
      await this.doSleep(delayMs);
    }
    // Unreachable: the loop always returns or throws.
    throw new Error('Klines request failed');
  }
}
