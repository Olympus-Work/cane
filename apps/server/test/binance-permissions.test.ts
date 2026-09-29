import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Market } from '@cane/core';
import type { HttpFn } from '../src/binance/rest.client.js';
import { BinanceApiPermissionChecker, judgeKey, KeyCheckError, type KeyPermissions, type KeyVerdict } from '../src/settings/binance-permissions.js';

const OK: KeyPermissions = { withdrawals: false, universalTransfer: false, spotTrading: true, futuresTrading: true };

/** Narrows a rejected verdict so `.message` is reachable under strict TS. */
const message = (v: KeyVerdict): string => (v.ok ? 'unexpectedly ok' : v.message);

describe('judgeKey (AC12)', () => {
  it('accepts a clean key with no markets in use', () => {
    expect(judgeKey(OK, [])).toEqual({ ok: true });
  });

  it('rejects withdrawals even when every market is tradeable', () => {
    const p = { ...OK, withdrawals: true };
    const none = judgeKey(p, []);
    expect(none.ok).toBe(false);
    expect(message(none)).toMatch(/withdraw/i);
    const withFutures = judgeKey(p, ['futures'] as readonly Market[]);
    expect(withFutures.ok).toBe(false);
    expect(message(withFutures)).toMatch(/withdraw/i);
  });

  it('rejects universal transfer', () => {
    const v = judgeKey({ ...OK, universalTransfer: true }, []);
    expect(v.ok).toBe(false);
    expect(message(v)).toMatch(/transfer/i);
  });

  it('rejects a key that cannot trade in any market when none are in use', () => {
    const v = judgeKey({ ...OK, spotTrading: false, futuresTrading: false }, []);
    expect(v.ok).toBe(false);
    expect(message(v)).toMatch(/cannot trade/i);
  });

  it('accepts spot-only or futures-only when no markets are in use', () => {
    expect(judgeKey({ ...OK, futuresTrading: false }, [])).toEqual({ ok: true });
    expect(judgeKey({ ...OK, spotTrading: false }, [])).toEqual({ ok: true });
  });

  it('rejects when a market in use is not tradeable', () => {
    const futures = judgeKey({ ...OK, futuresTrading: false }, ['futures'] as readonly Market[]);
    expect(futures.ok).toBe(false);
    expect(message(futures)).toContain('futures');
    const spot = judgeKey({ ...OK, spotTrading: false }, ['spot'] as readonly Market[]);
    expect(spot.ok).toBe(false);
    expect(message(spot)).toContain('spot');
  });

  it('names only the missing market when both are in use', () => {
    const v = judgeKey({ ...OK, futuresTrading: false }, ['spot', 'futures'] as readonly Market[]);
    expect(v.ok).toBe(false);
    expect(message(v)).toContain('futures');
    expect(message(v)).not.toContain('spot');
  });

  it('accepts when every market in use is tradeable', () => {
    expect(judgeKey(OK, ['spot', 'futures'] as readonly Market[])).toEqual({ ok: true });
  });
});

interface FakeCall {
  url: string;
  headers: Record<string, string>;
}

function fakeHttp(handler: (url: string) => { status: number; body: string }) {
  const calls: FakeCall[] = [];
  const fn: HttpFn = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const { status, body } = handler(url);
    return {
      status,
      headers: { get: () => null },
      text: async () => body,
    };
  };
  return { fn, calls };
}

const RESTRICTIONS = '/sapi/v1/account/apiRestrictions';

describe('BinanceApiPermissionChecker (AC12)', () => {
  afterEach(() => vi.useRealTimers());

  it('maps the apiRestrictions body and signs without leaking the secret', async () => {
    const { fn, calls } = fakeHttp((url) =>
      url.includes(RESTRICTIONS)
        ? { status: 200, body: '{"enableWithdrawals":false,"permitsUniversalTransfer":false,"enableSpotAndMarginTrading":true,"enableFutures":false}' }
        : { status: 200, body: '{"serverTime":1700000000000}' },
    );
    const checker = new BinanceApiPermissionChecker(fn);

    const p = await checker.check({ apiKey: 'fixture-key', apiSecret: 'fixture-secret' });
    expect(p).toEqual({ withdrawals: false, universalTransfer: false, spotTrading: true, futuresTrading: false });

    const restrictions = calls.find((c) => c.url.includes(RESTRICTIONS));
    expect(restrictions).toBeDefined();
    expect(restrictions!.headers['X-MBX-APIKEY']).toBe('fixture-key');
    expect(restrictions!.url).toContain('signature=');
    expect(restrictions!.url).not.toContain('fixture-secret');
  });

  it('wraps a rejected key in a KeyCheckError that never names the credentials', async () => {
    const { fn } = fakeHttp((url) =>
      url.includes(RESTRICTIONS)
        ? { status: 404, body: '{"code":-1,"msg":"Not Found"}' }
        : { status: 200, body: '{"serverTime":1700000000000}' },
    );
    const checker = new BinanceApiPermissionChecker(fn);

    const err = await checker.check({ apiKey: 'fixture-key', apiSecret: 'fixture-secret' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeyCheckError);
    expect((err as Error).message).not.toContain('fixture-key');
    expect((err as Error).message).not.toContain('fixture-secret');
  });

  it('wraps a network failure in a KeyCheckError after the retry budget', async () => {
    // The REST client retries with real sleeps (500 ms + 1 s + 2 s + 4 s); fake
    // the timers so the whole check settles instantly.
    vi.useFakeTimers();
    const http: HttpFn = async () => {
      throw new TypeError('network down');
    };
    const checker = new BinanceApiPermissionChecker(http);
    const assertion = expect(checker.check({ apiKey: 'fixture-key', apiSecret: 'fixture-secret' })).rejects.toBeInstanceOf(KeyCheckError);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });
});
