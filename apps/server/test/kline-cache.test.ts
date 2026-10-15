import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
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

describe('KlineCache concurrent access', () => {
  it('a reader never sees a half-written cache file while other instances rewrite it', async () => {
    const shared = await mkdtemp(path.join(tmpdir(), 'kline-cache-race-'));
    try {
      const H = 1000;
      const candles = Array.from({ length: 5000 }, (_, i) => makeCandle(i * H, i * H + H - 1));
      const fetchRange = vi.fn((_m: string, _s: string, _i: string, start: number, end: number) =>
        Promise.resolve(candles.filter((c) => c.openTime >= start && c.openTime <= end)),
      );
      const client = { fetchRange } as unknown as KlinesClient;
      // Separate instances stand in for the live engine and the replay-diff child.
      const writers = Array.from({ length: 4 }, () => new KlineCache(client, shared));
      await writers[0]!.closedCandles('futures', 'BTCUSDT', '4h', 4000 * H);

      const file = path.join(shared, 'futures-BTCUSDT-4h.json');
      const errors: unknown[] = [];
      let writing = true;
      const reader = (async () => {
        while (writing) {
          try {
            const rows = JSON.parse(await readFile(file, 'utf8')) as unknown[];
            if (rows.length < 4000) errors.push(new Error(`partial file: ${rows.length} rows`));
          } catch (err) {
            errors.push(err);
          }
        }
      })();
      const runs: Promise<Candle[]>[] = [];
      for (let round = 0; round < 25; round++) {
        for (const w of writers) runs.push(w.closedCandles('futures', 'BTCUSDT', '4h', (4000 + round) * H));
      }
      const results = await Promise.allSettled(runs);
      writing = false;
      await reader;

      expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
      expect(errors).toEqual([]);
      const leftovers = (await readdir(shared)).filter((f) => f.endsWith('.tmp'));
      expect(leftovers).toEqual([]);
    } finally {
      await rm(shared, { recursive: true, force: true });
    }
  });
});
