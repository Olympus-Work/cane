import { describe, expect, it } from 'vitest';
import { type BinanceCredentials, type HttpFn } from '../src/binance/rest.client.js';
import { BinanceExchangeReader } from '../src/exchange/binance-exchange-reader.js';
import { ExchangeReadError } from '../src/exchange/exchange-reader.js';

// Built at runtime so gitleaks never sees a credential-shaped literal.
const creds: BinanceCredentials = {
  apiKey: ['test', 'api', 'key'].join('-'),
  apiSecret: ['test', 'api', 'secret'].join('-'),
};

type Handler = (url: URL, init: { method: string; headers: Record<string, string> }) =>
  | { status: number; body: unknown }
  | Error;

function makeHttp(handler: Handler) {
  const calls: URL[] = [];
  const http: HttpFn = async (url, init) => {
    calls.push(new URL(url));
    const r = handler(new URL(url), init);
    if (r instanceof Error) throw r;
    return {
      status: r.status,
      headers: { get: () => null },
      text: async () => JSON.stringify(r.body),
    };
  };
  return { http, calls };
}

const SPOT = 'https://demo-api.binance.com';
const FUTURES = 'https://demo-fapi.binance.com';

const spotTickers = [
  { symbol: 'BTCUSDT', lastPrice: '20000', priceChangePercent: '1.5' },
  { symbol: 'ETHUSDT', lastPrice: '100', priceChangePercent: '-0.5' },
  { symbol: 'BTCUSDC', lastPrice: '20001', priceChangePercent: '1.5' },
];
const futuresTickers = [
  { symbol: 'BTCUSDT', lastPrice: '20010', priceChangePercent: '2.0' },
  { symbol: 'ETHUSDC', lastPrice: '101', priceChangePercent: '0.1' },
];
const positions = [
  {
    symbol: 'BTCUSDT',
    positionAmt: '0.002',
    entryPrice: '19000',
    markPrice: '20000',
    unRealizedProfit: '2',
    liquidationPrice: '0',
  },
  {
    symbol: 'ETHUSDT',
    positionAmt: '0',
    entryPrice: '0',
    markPrice: '100',
    unRealizedProfit: '0',
    liquidationPrice: '0',
  },
];

/** Answers every endpoint a snapshot() needs, plus exchangeInfo for isListed. */
const okHandler: Handler = (url) => {
  if (url.origin === SPOT) {
    if (url.pathname === '/api/v3/time') return { status: 200, body: { serverTime: 2_000_000 } };
    if (url.pathname === '/api/v3/account') {
      return {
        status: 200,
        body: { balances: [{ asset: 'USDT', free: '100', locked: '0' }, { asset: 'BTC', free: '0.5', locked: '0' }] },
      };
    }
    if (url.pathname === '/api/v3/ticker/price') {
      return { status: 200, body: [{ symbol: 'BTCUSDT', price: '20000' }] };
    }
    if (url.pathname === '/api/v3/ticker/24hr') return { status: 200, body: spotTickers };
    if (url.pathname === '/api/v3/exchangeInfo') {
      if (url.searchParams.get('symbol') === 'ETHUSDT') {
        return { status: 200, body: { symbols: [{ symbol: 'ETHUSDT', status: 'TRADING', quoteAsset: 'USDT' }] } };
      }
      if (url.searchParams.get('symbol') === 'ETHBUSD') {
        return { status: 200, body: { symbols: [{ symbol: 'ETHBUSD', status: 'TRADING', quoteAsset: 'BUSD' }] } };
      }
      if (url.searchParams.get('symbol') === 'GONEUSDT') {
        return { status: 400, body: { code: -1121, msg: 'Invalid symbol.' } };
      }
    }
  } else if (url.origin === FUTURES) {
    if (url.pathname === '/fapi/v1/time') return { status: 200, body: { serverTime: 2_000_000 } };
    if (url.pathname === '/fapi/v3/account') {
      return { status: 200, body: { totalMarginBalance: '250.5', availableBalance: '250.5' } };
    }
    if (url.pathname === '/fapi/v1/ticker/24hr') return { status: 200, body: futuresTickers };
    if (url.pathname === '/fapi/v3/positionRisk') return { status: 200, body: positions };
    if (url.pathname === '/fapi/v1/exchangeInfo') {
      return {
        status: 200,
        body: {
          symbols: [
            { symbol: 'BTCUSDT', status: 'TRADING', quoteAsset: 'USDT' },
            { symbol: 'DOGEUSDT', status: 'BREAKING', quoteAsset: 'USDT' },
          ],
        },
      };
    }
  }
  return { status: 404, body: { code: -1102, msg: 'Unknown path' } };
};

function makeReader(credsFn: () => Promise<BinanceCredentials | null>, handler: Handler, now: () => number) {
  const { http, calls } = makeHttp(handler);
  const reader = new BinanceExchangeReader(credsFn, http, 'testnet', now);
  return { reader, calls };
}

describe('BinanceExchangeReader', () => {
  it('builds a snapshot from hand-picked numbers', async () => {
    const t = 1_000_000;
    const { reader } = makeReader(async () => creds, okHandler, () => t);

    const snap = await reader.snapshot();

    expect(snap.spotEquity).toBe('10100');
    expect(snap.futuresEquity).toBe('250.5');
    expect(snap.tickers['spot:BTCUSDT']).toEqual({ price: '20000', changePct: '1.5' });
    expect(snap.tickers['spot:ETHUSDT']).toEqual({ price: '100', changePct: '-0.5' });
    expect(snap.tickers['futures:BTCUSDT']).toEqual({ price: '20010', changePct: '2.0' });
    expect('spot:BTCUSDC' in snap.tickers).toBe(false);
    expect('futures:ETHUSDC' in snap.tickers).toBe(false);
    expect(snap.futuresPositions).toEqual([
      {
        pair: 'BTCUSDT',
        amount: '0.002',
        entryPrice: '19000',
        markPrice: '20000',
        unrealizedPnl: '2',
        liquidationPrice: null,
      },
    ]);
  });

  it('caches for 15 s: no new requests inside the window, a refresh after', async () => {
    let t = 1_000_000;
    const { reader, calls } = makeReader(async () => creds, okHandler, () => t);

    const first = await reader.snapshot();
    const inside = await reader.snapshot();
    expect(inside).toBe(first);
    const countInside = calls.length;
    expect(countInside).toBeGreaterThan(0);

    t += 14_999;
    const stillCached = await reader.snapshot();
    expect(stillCached).toBe(first);
    expect(calls.length).toBe(countInside);

    t += 1;
    const refreshed = await reader.snapshot();
    expect(refreshed).not.toBe(first);
    expect(calls.length).toBeGreaterThan(countInside);
  });

  it('a failed refresh is not cached: the next call inside the window tries again', async () => {
    let t = 1_000_000;
    let fail = false;
    const handler: Handler = (url) => {
      if (fail && (url.pathname === '/api/v3/account' || url.pathname === '/fapi/v3/account')) {
        // A definite 4xx: rejected without retry, so the test stays fast.
        return { status: 400, body: { code: -1102, msg: 'Unknown parameter.' } };
      }
      return okHandler(url, { method: 'GET', headers: {} });
    };
    const { reader, calls } = makeReader(async () => creds, handler, () => t);

    const good = await reader.snapshot();
    expect(good.spotEquity).toBe('10100');

    t += 15_000;
    fail = true;
    const failed = reader.snapshot().catch((e: unknown) => e);
    const err = await failed;
    expect(err).toBeInstanceOf(ExchangeReadError);
    expect((err as ExchangeReadError).kind).toBe('unreachable');
    expect((err as ExchangeReadError).message).not.toContain('binance.com');
    const countAfterFail = calls.length;

    t += 1000;
    const retried = reader.snapshot().catch((e: unknown) => e);
    const second = await retried;
    expect(second).toBeInstanceOf(ExchangeReadError);
    expect(calls.length).toBeGreaterThan(countAfterFail);

    fail = false;
    const recovered = await reader.snapshot();
    expect(recovered).toEqual(good);
  });

  it('no saved key: snapshot() is no_key, isListed still works', async () => {
    const t = 1_000_000;
    const { reader } = makeReader(async () => null, okHandler, () => t);

    const err = (await reader.snapshot().catch((e: unknown) => e)) as ExchangeReadError;
    expect(err).toBeInstanceOf(ExchangeReadError);
    expect(err.kind).toBe('no_key');

    expect(await reader.isListed('spot', 'ETHUSDT')).toBe(true);
  });

  it('isListed: TRADING USDT is true; BREAKING, BUSD quote, missing futures and spot -1121 are false', async () => {
    const t = 1_000_000;
    const { reader } = makeReader(async () => creds, okHandler, () => t);

    expect(await reader.isListed('spot', 'ETHUSDT')).toBe(true);
    expect(await reader.isListed('futures', 'BTCUSDT')).toBe(true);
    expect(await reader.isListed('futures', 'DOGEUSDT')).toBe(false);
    expect(await reader.isListed('spot', 'ETHBUSD')).toBe(false);
    expect(await reader.isListed('futures', 'NOPEUSDT')).toBe(false);
    expect(await reader.isListed('spot', 'GONEUSDT')).toBe(false);
  });

  it('a failed request never leaks the key or secret in its error message', async () => {
    const t = 1_000_000;
    const { reader } = makeReader(
      async () => creds,
      () => ({ status: 400, body: { code: -1102, msg: 'Unknown parameter.' } }),
      () => t,
    );

    const err = (await reader.snapshot().catch((e: unknown) => e)) as ExchangeReadError;
    expect(err).toBeInstanceOf(ExchangeReadError);
    expect(err.kind).toBe('unreachable');
    expect(err.message).not.toContain(creds.apiKey);
    expect(err.message).not.toContain(creds.apiSecret);
  });

  it('concurrent callers share one in-flight refresh', async () => {
    let t = 1_000_000;
    const { reader, calls } = makeReader(async () => creds, okHandler, () => t);

    const [a, b] = await Promise.all([reader.snapshot(), reader.snapshot()]);
    expect(a).toBe(b);
    const count = calls.length;

    t += 20_000;
    const [c, d] = await Promise.all([reader.snapshot(), reader.snapshot()]);
    expect(c).toBe(d);
    expect(calls.length - count).toBe(count);
  });
});
