import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Decimal } from 'decimal.js';
import {
  KlinesClient,
  parseKline,
  type FetchFn,
} from '../src/market-data/klines.client.js';

type FakeResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
};

function makeResponse(body: unknown, status = 200, retryAfter?: string): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name === 'Retry-After' ? retryAfter ?? null : null) },
    json: async () => body,
  };
}

function makeRow(openTime: number): unknown[] {
  return [openTime, '1.5', '2', '1', '1.75', '10', openTime + 999, 'x'];
}

function makeClient(fetchFn: ReturnType<typeof vi.fn>) {
  const sleep = vi.fn(async () => {});
  const client = new KlinesClient(fetchFn as unknown as FetchFn, sleep);
  return { client, sleep };
}

describe('parseKline', () => {
  it('parses a kline array into Decimals', () => {
    const candle = parseKline([1000, '1.5', '2', '1', '1.75', '10', 1999, 'x']);
    expect(candle.openTime).toBe(1000);
    expect(candle.closeTime).toBe(1999);
    expect(candle.close.toString()).toBe('1.75');
    expect(candle.open).toBeInstanceOf(Decimal);
    expect(candle.volume.toString()).toBe('10');
  });

  it('throws on a non-array row', () => {
    expect(() => parseKline(['a'])).toThrow();
  });
});

describe('KlinesClient.fetchRange', () => {
  it('paginates on futures until a short page', async () => {
    const firstPage = Array.from({ length: 1500 }, (_, i) => makeRow(i * 1000));
    const secondPage = Array.from({ length: 3 }, (_, i) => makeRow((1500 + i) * 1000));
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(firstPage))
      .mockResolvedValueOnce(makeResponse(secondPage));
    const { client } = makeClient(fetchFn);

    const candles = await client.fetchRange('futures', 'BTCUSDT', '4h', 0, 10_000_000);

    expect(candles).toHaveLength(1503);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const secondUrl = fetchFn.mock.calls[1]![0]!;
    expect(secondUrl).toContain('startTime=1499001');
  });

  it('builds public URLs with no auth params and no headers', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse([makeRow(0)]));
    const { client } = makeClient(fetchFn);

    await client.fetchRange('futures', 'BTCUSDT', '4h', 0, 10_000);
    await client.fetchRange('spot', 'ETHUSDT', '1d', 0, 10_000);

    const [futUrl, futInit] = fetchFn.mock.calls[0]!;
    const [spotUrl, spotInit] = fetchFn.mock.calls[1]!;
    expect(futUrl).toMatch(/^https:\/\/fapi\.binance\.com\/fapi\/v1\/klines\?/);
    expect(spotUrl).toMatch(/^https:\/\/api\.binance\.com\/api\/v3\/klines\?/);
    for (const url of [futUrl, spotUrl]) {
      expect(url).not.toContain('signature');
      expect(url).not.toContain('timestamp');
    }
    expect((futInit as { headers?: unknown } | undefined)?.headers).toBeUndefined();
    expect((spotInit as { headers?: unknown } | undefined)?.headers).toBeUndefined();
  });

  it('retries 429 using Retry-After then returns the page', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(makeResponse([], 429, '1'))
      .mockResolvedValueOnce(makeResponse([makeRow(0), makeRow(1000)]));
    const { client, sleep } = makeClient(fetchFn);

    const candles = await client.fetchRange('futures', 'BTCUSDT', '4h', 0, 10_000);

    expect(candles).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('throws on status 400 without retrying', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse([], 400));
    const { client } = makeClient(fetchFn);

    await expect(client.fetchRange('futures', 'BTCUSDT', '4h', 0, 10_000)).rejects.toThrow(
      /400/,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('throws on an invalid symbol', async () => {
    const fetchFn = vi.fn();
    const { client } = makeClient(fetchFn);

    await expect(client.fetchRange('futures', 'btc/usdt', '4h', 0, 10_000)).rejects.toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
