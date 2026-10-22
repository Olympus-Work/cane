import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { FUNDING_PAGE_LIMIT, FundingClient, parseFundingRow } from '../src/funding/funding.client.js';
import type { FetchFn } from '../src/market-data/klines.client.js';

const H8 = 8 * 60 * 60 * 1000;
const T0 = Date.UTC(2024, 0, 1);

function makeResponse(body: unknown, status = 200, retryAfter?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name === 'Retry-After' ? retryAfter ?? null : null) },
    json: async () => body,
  };
}

/** Shape of a `/fapi/v1/fundingRate` row (Binance docs, 2026). */
function row(time: number, rate = '0.00010000', markPrice: string | undefined = '42000.10000000') {
  return { symbol: 'BTCUSDT', fundingTime: time, fundingRate: rate, markPrice };
}

function makeClient(fetchFn: ReturnType<typeof vi.fn>) {
  const sleep = vi.fn(async () => {});
  return { client: new FundingClient(fetchFn as unknown as FetchFn, sleep), sleep };
}

describe('parseFundingRow', () => {
  it('parses rate and mark price as decimals', () => {
    const r = parseFundingRow(row(T0, '-0.00037500', '34287.54619963'));
    expect(r.fundingTime).toBe(T0);
    expect(r.rate.toString()).toBe('-0.000375');
    expect(r.markPrice!.toString()).toBe('34287.54619963');
  });

  it('keeps an empty mark price of an old row as null', () => {
    expect(parseFundingRow(row(T0, '0.0001', '')).markPrice).toBeNull();
    expect(parseFundingRow({ symbol: 'BTCUSDT', fundingTime: T0, fundingRate: '0.0001' }).markPrice).toBeNull();
  });

  it.each([
    [{ ...row(T0), fundingRate: '' }],
    [{ ...row(T0), fundingRate: 0.0001 }],
    [{ ...row(T0), fundingTime: '1704067200000' }],
    [null],
  ])('rejects a malformed row %#', (bad) => {
    expect(() => parseFundingRow(bad)).toThrow();
  });
});

describe('FundingClient.fundingHistory', () => {
  it('pages through full pages, public URL only, sorted and de-duplicated', async () => {
    const page1 = Array.from({ length: FUNDING_PAGE_LIMIT }, (_, i) => row(T0 + i * H8));
    const lastOfPage1 = T0 + (FUNDING_PAGE_LIMIT - 1) * H8;
    const page2 = [row(lastOfPage1), row(lastOfPage1 + H8), row(lastOfPage1 + 2 * H8)];
    const fetchFn = vi.fn().mockResolvedValueOnce(makeResponse(page1)).mockResolvedValueOnce(makeResponse(page2));
    const { client } = makeClient(fetchFn);

    const events = await client.fundingHistory('BTCUSDT', T0, T0 + 2000 * H8);

    expect(events).toHaveLength(FUNDING_PAGE_LIMIT + 2);
    expect(events.at(-1)!.fundingTime).toBe(lastOfPage1 + 2 * H8);
    const [url1, init1] = fetchFn.mock.calls[0]!;
    const [url2] = fetchFn.mock.calls[1]!;
    expect(url1).toBe(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&startTime=${T0}&endTime=${T0 + 2000 * H8}&limit=1000`);
    expect(url2).toContain(`startTime=${lastOfPage1 + 1}&`);
    expect(url1).not.toMatch(/signature|timestamp/);
    expect((init1 as { headers?: unknown }).headers).toBeUndefined();
  });

  it('stops after a short page', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse([row(T0)]));
    const { client } = makeClient(fetchFn);
    await client.fundingHistory('BTCUSDT', T0, T0 + 10 * H8);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries 429 with Retry-After', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(makeResponse({}, 429, '2')).mockResolvedValueOnce(makeResponse([row(T0)]));
    const { client, sleep } = makeClient(fetchFn);
    expect(await client.fundingHistory('BTCUSDT', T0, T0 + H8)).toHaveLength(1);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('throws on 400 without retrying', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({ code: -1121 }, 400));
    const { client } = makeClient(fetchFn);
    await expect(client.fundingHistory('BTCUSDT', T0, T0 + H8)).rejects.toThrow(/400/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid symbol before any request, and a row for another symbol', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse([{ ...row(T0), symbol: 'ETHUSDT' }]));
    const { client } = makeClient(fetchFn);
    await expect(client.fundingHistory('btc/usdt', T0, T0 + H8)).rejects.toThrow(/Invalid symbol/);
    expect(fetchFn).not.toHaveBeenCalled();
    await expect(client.fundingHistory('BTCUSDT', T0, T0 + H8)).rejects.toThrow(/ETHUSDT/);
  });
});

describe('FundingClient.premiumIndex and fundingInfo', () => {
  it('parses the predicted rate and next funding time', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeResponse({
        symbol: 'BTCUSDT',
        markPrice: '64000.50000000',
        indexPrice: '64010.00000000',
        estimatedSettlePrice: '64005.00000000',
        lastFundingRate: '0.00012000',
        interestRate: '0.00010000',
        nextFundingTime: T0 + H8,
        time: T0 + 1000,
      }),
    );
    const { client } = makeClient(fetchFn);
    const p = await client.premiumIndex('BTCUSDT');
    expect(p.predictedRate.toString()).toBe('0.00012');
    expect(p.nextFundingTime).toBe(T0 + H8);
    expect(fetchFn.mock.calls[0]![0]).toBe('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT');
  });

  it('lists adjusted intervals', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeResponse([
        { symbol: 'BLZUSDT', adjustedFundingRateCap: '0.02500000', adjustedFundingRateFloor: '-0.02500000', fundingIntervalHours: 4, disclaimer: false },
      ]),
    );
    const { client } = makeClient(fetchFn);
    expect(await client.fundingInfo()).toEqual([{ symbol: 'BLZUSDT', fundingIntervalHours: 4 }]);
  });

  it('rejects a malformed fundingInfo row', async () => {
    const { client } = makeClient(vi.fn().mockResolvedValue(makeResponse([{ symbol: 'X' }])));
    await expect(client.fundingInfo()).rejects.toThrow(/Invalid fundingInfo row/);
  });
});

/** A recorded Binance response body, parsed fresh so a test may edit it. */
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/binance/${name}`, import.meta.url), 'utf8'));
}

/** Shape of one `/fapi/v1/premiumIndex` array row (Binance docs, 2026). */
function premiumRow(symbol: string, nextFundingTime = T0 + H8) {
  return {
    symbol,
    markPrice: '64000.50000000',
    indexPrice: '64010.00000000',
    estimatedSettlePrice: '64005.00000000',
    lastFundingRate: '0.00012000',
    interestRate: '0.00010000',
    nextFundingTime,
    time: T0 + 1000,
  };
}

describe('FundingClient.perpListings', () => {
  it('parses every symbol of the recorded futures exchangeInfo', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse(fixture('futures-exchange-info-candidates.json')));
    const { client } = makeClient(fetchFn);

    const listings = await client.perpListings();

    expect(listings).toHaveLength(8);
    const btc = listings.find((l) => l.symbol === 'BTCUSDT')!;
    expect(btc.contractType).toBe('PERPETUAL');
    expect(btc.status).toBe('TRADING');
    expect(btc.quoteAsset).toBe('USDT');
    expect(Number.isInteger(btc.onboardDate)).toBe(true);
    for (const l of listings) expect(Number.isInteger(l.onboardDate)).toBe(true);
    expect(fetchFn.mock.calls[0]![0]).toBe('https://fapi.binance.com/fapi/v1/exchangeInfo');
  });

  it('throws on a body without a symbols array', async () => {
    const { client } = makeClient(vi.fn().mockResolvedValue(makeResponse({ timezone: 'UTC', serverTime: T0 })));
    await expect(client.perpListings()).rejects.toThrow(/no symbols array/);
  });
});

describe('FundingClient.spotSymbols', () => {
  it('collects the TRADING spot symbols and leaves other statuses out', async () => {
    const body = fixture('spot-exchange-info-trading.json') as { symbols: unknown[] };
    body.symbols.push({ symbol: 'LUNAUSDT', status: 'BREAK' });
    const fetchFn = vi.fn().mockResolvedValue(makeResponse(body));
    const { client } = makeClient(fetchFn);

    const symbols = await client.spotSymbols();

    expect(symbols).toBeInstanceOf(Set);
    expect([...symbols].sort()).toEqual(['BTCUSDT', 'ETHUSDT', 'PEPEUSDT']);
    expect(symbols.has('LUNAUSDT')).toBe(false);
    expect(fetchFn.mock.calls[0]![0]).toBe('https://api.binance.com/api/v3/exchangeInfo?symbolStatus=TRADING');
  });
});

describe('FundingClient.premiumIndexAll', () => {
  it('parses an array body without a query string', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse([premiumRow('BTCUSDT'), premiumRow('ETHUSDT', T0 + 2 * H8)]));
    const { client } = makeClient(fetchFn);

    const rows = await client.premiumIndexAll();

    expect(rows.map((r) => r.symbol)).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(rows[0]!.markPrice.toString()).toBe('64000.5');
    expect(rows[0]!.predictedRate.toString()).toBe('0.00012');
    expect(rows[1]!.nextFundingTime).toBe(T0 + 2 * H8);
    expect(rows[0]!.time).toBe(T0 + 1000);
    expect(fetchFn.mock.calls[0]![0]).toBe('https://fapi.binance.com/fapi/v1/premiumIndex');
  });

  it('rejects a non-array body', async () => {
    const { client } = makeClient(vi.fn().mockResolvedValue(makeResponse(premiumRow('BTCUSDT'))));
    await expect(client.premiumIndexAll()).rejects.toThrow(/expected an array/);
  });
});

describe('FundingClient.settledAt', () => {
  const slot = Date.UTC(2024, 0, 1, 8);

  it('asks for the window around the slot, without a symbol', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeResponse([
        { ...row(slot), symbol: 'BTCUSDT' },
        { ...row(slot), symbol: 'ETHUSDT', fundingRate: '-0.00020000' },
      ]),
    );
    const { client } = makeClient(fetchFn);

    const rows = await client.settledAt(slot);

    expect(fetchFn.mock.calls[0]![0]).toBe(
      `https://fapi.binance.com/fapi/v1/fundingRate?startTime=${slot - 300000}&endTime=${slot + 300000}&limit=1000`,
    );
    expect(rows!.map((r) => [r.symbol, r.fundingTime])).toEqual([
      ['BTCUSDT', slot],
      ['ETHUSDT', slot],
    ]);
    expect(rows![1]!.rate.toString()).toBe('-0.0002');
  });

  it('returns null when the page is full: it may be truncated', async () => {
    const fullPage = Array.from({ length: FUNDING_PAGE_LIMIT }, (_, i) => ({ ...row(slot), symbol: `S${i}USDT` }));
    const { client } = makeClient(vi.fn().mockResolvedValue(makeResponse(fullPage)));
    expect(await client.settledAt(slot)).toBeNull();
  });
});

describe('FundingClient pacing', () => {
  it('sleeps between two requests when a pace is set', async () => {
    const order: string[] = [];
    const fetchFn = vi.fn(async () => {
      order.push('fetch');
      return makeResponse(premiumRow('BTCUSDT'));
    });
    const sleep = vi.fn(async (_ms: number) => {
      order.push('sleep');
    });
    const client = new FundingClient(fetchFn as unknown as FetchFn, sleep, 700);

    await client.premiumIndex('BTCUSDT');
    await client.premiumIndex('BTCUSDT');

    expect(order).toEqual(['fetch', 'sleep', 'fetch']);
    expect(sleep).toHaveBeenCalledTimes(1);
    const waited = sleep.mock.calls[0]![0];
    expect(waited).toBeGreaterThan(0);
    expect(waited).toBeLessThanOrEqual(700);
  });

  it('does not pace without a third argument', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse(premiumRow('BTCUSDT')));
    const { client, sleep } = makeClient(fetchFn);
    await client.premiumIndex('BTCUSDT');
    await client.premiumIndex('BTCUSDT');
    expect(sleep).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
