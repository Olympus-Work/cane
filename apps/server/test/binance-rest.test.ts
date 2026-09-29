import { describe, expect, it } from 'vitest';
import {
  BinanceError,
  BinanceRestClient,
  UnknownOutcomeError,
  hmacHex,
  type HttpFn,
} from '../src/binance/rest.client.js';
import { ENDPOINTS } from '../src/binance/endpoints.js';

const creds = { apiKey: 'test-api-key', apiSecret: 'test-api-secret' };

type QueueItem = { status: number; body: unknown; retryAfter?: string } | 'network';

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function makeHttp(queue: QueueItem[]): { http: HttpFn; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const http: HttpFn = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers });
    const item = queue.shift();
    if (item === undefined) throw new Error('unexpected request');
    if (item === 'network') throw new TypeError('fetch failed');
    return {
      status: item.status,
      headers: { get: (n: string) => (n === 'Retry-After' ? item.retryAfter ?? null : null) },
      text: async () => JSON.stringify(item.body),
    };
  };
  return { http, calls };
}

function makeClient(queue: QueueItem[]) {
  const { http, calls } = makeHttp(queue);
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  const now = () => 1_000_000;
  const client = new BinanceRestClient(ENDPOINTS.testnet, () => creds, http, sleep, now);
  return { client, calls, sleeps };
}

describe('BinanceRestClient', () => {
  it('signed request syncs time first and signs the query', async () => {
    const { client, calls } = makeClient([
      { status: 200, body: { serverTime: 1_000_500 } },
      { status: 200, body: { ok: true } },
    ]);

    const body = await client.request('spot', 'GET', '/api/v3/account', { omitZeroBalances: 'true' }, 'signed', 'safe');

    expect(body).toEqual({ ok: true });
    expect(calls[0]!.url).toMatch(/^https:\/\/demo-api\.binance\.com\/api\/v3\/time/);
    const u = new URL(calls[1]!.url);
    expect(u.pathname).toBe('/api/v3/account');
    expect(calls[1]!.headers['X-MBX-APIKEY']).toBe('test-api-key');
    expect(u.searchParams.get('timestamp')).toBe('1000500');
    expect(u.searchParams.get('recvWindow')).toBe('5000');
    const expected = hmacHex('test-api-secret', u.search.slice(1).split('&signature=')[0]!);
    expect(u.searchParams.get('signature')).toBe(expected);
  });

  it('public request has no key and no signature', async () => {
    const { client, calls } = makeClient([{ status: 200, body: [] }]);

    await client.request('futures', 'GET', '/fapi/v1/exchangeInfo', { a: undefined, b: 1 }, 'none', 'safe');

    expect(calls[0]!.url).toMatch(/^https:\/\/demo-fapi\.binance\.com\/fapi\/v1\/exchangeInfo/);
    expect(calls[0]!.headers['X-MBX-APIKEY']).toBeUndefined();
    expect(calls[0]!.url).not.toContain('signature');
    expect(calls[0]!.url).not.toContain('timestamp');
    expect(calls[0]!.url).toContain('b=1');
    expect(calls[0]!.url).not.toContain('a=');
  });

  it('-1021 resyncs the clock and retries once', async () => {
    const { client, calls } = makeClient([
      { status: 200, body: { serverTime: 1_000_500 } },
      { status: 400, body: { code: -1021, msg: 'Timestamp outside' } },
      { status: 200, body: { serverTime: 1_002_000 } },
      { status: 200, body: { ok: 1 } },
    ]);

    const body = await client.request('spot', 'POST', '/api/v3/order', {}, 'signed', 'once');

    expect(body).toEqual({ ok: 1 });
    expect(new URL(calls[3]!.url).searchParams.get('timestamp')).toBe('1002000');
  });

  it('safe mode retries 5xx and honours Retry-After', async () => {
    const { client, sleeps } = makeClient([
      { status: 503, body: {} },
      { status: 429, body: { code: -1003, msg: 'too many' }, retryAfter: '3' },
      { status: 200, body: { ok: 1 } },
    ]);

    const body = await client.request('spot', 'GET', '/api/v3/account', {}, 'none', 'safe');

    expect(body).toEqual({ ok: 1 });
    expect(sleeps).toEqual([500, 3000]);
  });

  it('safe mode gives up after 5 attempts', async () => {
    const { client, calls } = makeClient([
      { status: 500, body: {} },
      { status: 500, body: {} },
      { status: 500, body: {} },
      { status: 500, body: {} },
      { status: 500, body: {} },
    ]);

    await expect(client.request('spot', 'GET', '/api/v3/account', {}, 'none', 'safe')).rejects.toMatchObject({
      name: 'BinanceError',
      status: 500,
    });
    expect(calls).toHaveLength(5);
  });

  it('safe mode retries network errors', async () => {
    const { client } = makeClient(['network', { status: 200, body: { ok: 1 } }]);

    const body = await client.request('spot', 'GET', '/api/v3/account', {}, 'none', 'safe');

    expect(body).toEqual({ ok: 1 });
  });

  it('once mode: network error → UnknownOutcomeError, no retry', async () => {
    const { client, calls } = makeClient([
      { status: 200, body: { serverTime: 1_000_500 } },
      'network',
    ]);

    await expect(client.request('spot', 'POST', '/api/v3/order', {}, 'signed', 'once')).rejects.toBeInstanceOf(
      UnknownOutcomeError,
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toMatch(/^https:\/\/demo-api\.binance\.com\/api\/v3\/time/);
    expect(calls[1]!.url).toMatch(/^https:\/\/demo-api\.binance\.com\/api\/v3\/order/);
  });

  it('once mode: 503 and -1007 → UnknownOutcomeError', async () => {
    const { client: c503 } = makeClient([{ status: 503, body: {} }]);
    await expect(c503.request('spot', 'POST', '/api/v3/order', {}, 'none', 'once')).rejects.toBeInstanceOf(
      UnknownOutcomeError,
    );

    const { client: c1007 } = makeClient([{ status: 400, body: { code: -1007, msg: 'Timeout' } }]);
    await expect(c1007.request('spot', 'POST', '/api/v3/order', {}, 'none', 'once')).rejects.toBeInstanceOf(
      UnknownOutcomeError,
    );
  });

  it('once mode: 429 is a definite rejection', async () => {
    const { client } = makeClient([{ status: 429, body: { code: -1015, msg: 'Too many orders' } }]);

    const err = await client
      .request('spot', 'POST', '/api/v3/order', {}, 'none', 'once')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BinanceError);
    expect(err).not.toBeInstanceOf(UnknownOutcomeError);
    expect((err as BinanceError).status).toBe(429);
  });

  it('a 4xx is a BinanceError with code and message', async () => {
    const { client } = makeClient([
      { status: 200, body: { serverTime: 1_000_500 } },
      { status: 400, body: { code: -2010, msg: 'Duplicate order sent.' } },
    ]);

    const err = await client
      .request('spot', 'POST', '/api/v3/order', {}, 'signed', 'once')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BinanceError);
    const binanceErr = err as BinanceError;
    expect(binanceErr.code).toBe(-2010);
    expect(binanceErr.binanceMsg).toBe('Duplicate order sent.');
    expect(binanceErr.message).toContain('POST /api/v3/order');
  });

  it('errors never leak the key, secret or signature', async () => {
    const { client } = makeClient([
      { status: 200, body: { serverTime: 1_000_500 } },
      { status: 400, body: { code: -2010, msg: 'Duplicate order sent.' } },
    ]);

    const err = (await client
      .request('spot', 'POST', '/api/v3/order', {}, 'signed', 'once')
      .catch((e: unknown) => e)) as BinanceError;

    expect(err.message).not.toContain('test-api-key');
    expect(err.message).not.toContain('test-api-secret');
    expect(err.message).not.toContain('signature');
  });

  it('serverNow uses the synced offset', async () => {
    const { client, calls } = makeClient([{ status: 200, body: { serverTime: 1_000_250 } }]);

    expect(await client.serverNow('futures')).toBe(1_000_250);
    expect(calls[0]!.url).toBe('https://demo-fapi.binance.com/fapi/v1/time');
  });
});
