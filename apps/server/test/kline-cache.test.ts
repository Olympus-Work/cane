import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Decimal } from 'decimal.js';
import type { Candle } from '@cane/core';
import { KlineCache } from '../src/market-data/kline-cache.js';
import type { KlinesClient } from '../src/market-data/klines.client.js';

function makeCandle(openTime: number, closeTime: number): Candle {
  return {
    openTime,
    closeTime,
    open: new Decimal('1'),
    high: new Decimal('2'),
    low: new Decimal('0.5'),
    close: new Decimal('1.5'),
    volume: new Decimal('10'),
  };
}

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kline-cache-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('KlineCache.closedCandles', () => {
  it('keeps only closed candles, caches them and fetches from the last openTime + 1', async () => {
    const fetchRange = vi
      .fn()
      .mockResolvedValueOnce([
        makeCandle(0, 999),
        makeCandle(1000, 1999),
        makeCandle(2000, 2999),
      ])
      .mockResolvedValueOnce([makeCandle(2000, 2999)]);
    const client = { fetchRange } as unknown as KlinesClient;
    const cache = new KlineCache(client, dir);

    const first = await cache.closedCandles('spot', 'BTCUSDT', '4h', 2500);
    expect(first.map((c) => c.openTime)).toEqual([0, 1000]);
    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(fetchRange.mock.calls[0]![3]).toBe(0);

    const file = path.join(dir, 'spot-BTCUSDT-4h.json');
    const rows = JSON.parse(await readFile(file, 'utf8')) as unknown[];
    expect(rows).toHaveLength(2);

    const second = await cache.closedCandles('spot', 'BTCUSDT', '4h', 3500);
    expect(second.map((c) => c.openTime)).toEqual([0, 1000, 2000]);
    expect(fetchRange).toHaveBeenCalledTimes(2);
    expect(fetchRange.mock.calls[1]![3]).toBe(1001);
  });
});
