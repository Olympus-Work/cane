import { Inject, Injectable } from '@nestjs/common';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Decimal } from 'decimal.js';
import type { Candle, Timeframe } from '@cane/core';
import { KlinesClient, type KlineMarket } from './klines.client.js';

export const KLINE_CACHE_DIR = Symbol('KLINE_CACHE_DIR');

export const DEFAULT_KLINE_CACHE_DIR = fileURLToPath(
  new URL('../../../../data/klines/', import.meta.url),
);

/** Cached row: [openTime, closeTime, open, high, low, close, volume], prices as strings. */
type CachedRow = [number, number, string, string, string, string, string];

function toCachedRow(candle: Candle): CachedRow {
  return [
    candle.openTime,
    candle.closeTime,
    candle.open.toString(),
    candle.high.toString(),
    candle.low.toString(),
    candle.close.toString(),
    candle.volume.toString(),
  ];
}

function fromCachedRow(row: unknown): Candle {
  if (
    !Array.isArray(row) ||
    row.length < 7 ||
    typeof row[0] !== 'number' ||
    typeof row[1] !== 'number' ||
    typeof row[2] !== 'string' ||
    typeof row[3] !== 'string' ||
    typeof row[4] !== 'string' ||
    typeof row[5] !== 'string' ||
    typeof row[6] !== 'string'
  ) {
    throw new Error(`Invalid cached kline row: ${JSON.stringify(row)}`);
  }
  return {
    openTime: row[0],
    closeTime: row[1],
    open: new Decimal(row[2]),
    high: new Decimal(row[3]),
    low: new Decimal(row[4]),
    close: new Decimal(row[5]),
    volume: new Decimal(row[6]),
  };
}

@Injectable()
export class KlineCache {
  constructor(
    private readonly client: KlinesClient,
    @Inject(KLINE_CACHE_DIR) private readonly dir: string,
  ) {}

  private filePath(market: KlineMarket, symbol: string, interval: Timeframe): string {
    return path.join(this.dir, `${market}-${symbol}-${interval}.json`);
  }

  async closedCandles(
    market: KlineMarket,
    symbol: string,
    interval: Timeframe,
    nowMs: number,
  ): Promise<Candle[]> {
    const file = this.filePath(market, symbol, interval);

    let cached: Candle[] = [];
    try {
      const raw = await readFile(file, 'utf8');
      const rows: unknown = JSON.parse(raw);
      if (!Array.isArray(rows)) {
        throw new Error('cache file is not an array');
      }
      cached = rows.map(fromCachedRow);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    const start = cached.reduce((max, c) => (c.openTime > max ? c.openTime : max), -1) + 1;
    const fetched = start <= nowMs ? await this.client.fetchRange(market, symbol, interval, start, nowMs) : [];

    const byOpenTime = new Map<number, Candle>();
    for (const candle of [...cached, ...fetched]) {
      byOpenTime.set(candle.openTime, candle);
    }
    const closed = [...byOpenTime.values()]
      .filter((c) => c.closeTime < nowMs)
      .sort((a, b) => a.openTime - b.openTime);

    await mkdir(this.dir, { recursive: true });
    await writeFile(file, JSON.stringify(closed.map(toCachedRow), null, 2));

    return closed;
  }
}
