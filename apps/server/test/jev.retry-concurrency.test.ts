import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Decimal } from 'decimal.js';
import { FACTOR_NAMES, type ConfluenceFeatures, type Side } from '@cane/core';
import { JEV_MODEL, JevClient, type JevFetch } from '../src/jev/jev.client.js';

const KEY = 'test-key-not-real';

function features(side: Side): ConfluenceFeatures {
  return {
    side,
    timeframe: '1d',
    signalOpenTime: 1_700_000_000_000,
    channel: { pivotCount: 4, slopePctPerBar: new Decimal('-0.35'), touches: 3, closeBeyondPct: new Decimal('1.2') },
    exhaustion: { longestBigBodyRun: 2, gapCount: 1, volumeSpike: new Decimal('2.5') },
    swing: { changePct: new Decimal('4.1'), barsApart: 18 },
  };
}

const reply = (status: number, body: unknown) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

function noulBody(side: Side, values: [number, number, number], extra: Record<string, unknown> = {}) {
  const answers: Record<string, unknown> = {};
  FACTOR_NAMES[side].forEach((name, i) => (answers[name] = { type: 'noul', noul: values[i] }));
  return { model: JEV_MODEL, answers, usage: { input_tokens: 300, output_tokens: 20 }, ...extra };
}

const input = (side: Side) => ({ side, timeframe: '1d' as const, features: features(side) });

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function makeClient(fetch: JevFetch, opts: { timeoutMs?: number; maxRetries?: number; maxConcurrent?: number } = {}) {
  let t = 1000;
  return new JevClient({
    apiKey: KEY,
    fetch,
    now: () => (t += 7),
    timeoutMs: opts.timeoutMs,
    maxRetries: opts.maxRetries,
    maxConcurrent: opts.maxConcurrent,
  });
}

describe('JevClient retry and concurrency', () => {
  it('default (no maxRetries): a 500 is not retried', async () => {
    const fetch = vi.fn<JevFetch>(reply(500, {}));
    const call = await makeClient(fetch).classify(input('long'));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(call.result).toEqual({ ok: false, reason: 'error' });
  });

  it('maxRetries 2: retries 503 and 429 until a 200', async () => {
    const fetch = vi.fn<JevFetch>()
      .mockImplementationOnce(reply(503, {}))
      .mockImplementationOnce(reply(429, {}))
      .mockImplementationOnce(reply(200, noulBody('long', [0.9, 0.8, 0.7])));
    const call = await makeClient(fetch, { maxRetries: 2 }).classify(input('long'));

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(call.result.ok).toBe(true);
  });

  it('maxRetries 2: an always-500 exhausts the attempts and reports the status', async () => {
    const fetch = vi.fn<JevFetch>(reply(500, {}));
    const call = await makeClient(fetch, { maxRetries: 2 }).classify(input('long'));

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(call.result).toEqual({ ok: false, reason: 'error' });
    expect(call.error).toBe('HTTP 500');
  });

  it('maxRetries 2: a 400 (other 4xx) is not retried', async () => {
    const fetch = vi.fn<JevFetch>(reply(400, {}));
    const call = await makeClient(fetch, { maxRetries: 2 }).classify(input('long'));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(call.result).toEqual({ ok: false, reason: 'error' });
  });

  it('maxRetries 1: a network error (TypeError) is retried', async () => {
    const fetch = vi.fn<JevFetch>()
      .mockImplementationOnce(async () => {
        throw new TypeError('boom');
      })
      .mockImplementationOnce(reply(200, noulBody('long', [0.9, 0.8, 0.7])));
    const call = await makeClient(fetch, { maxRetries: 1 }).classify(input('long'));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(call.result.ok).toBe(true);
  });

  it('maxRetries 1: an always-failing network error exhausts the attempts', async () => {
    const fetch = vi.fn<JevFetch>(async () => {
      throw new TypeError('boom');
    });
    const call = await makeClient(fetch, { maxRetries: 1 }).classify(input('long'));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(call.result).toEqual({ ok: false, reason: 'error' });
    expect(call.error).toBe('request failed (TypeError)');
  });

  it('maxRetries 3: a timeout is not retried (one timer covers the whole call)', async () => {
    const fetch = vi.fn<JevFetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          if (init.signal.aborted) {
            reject(new Error('aborted'));
            return;
          }
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const call = await makeClient(fetch, { maxRetries: 3, timeoutMs: 50 }).classify(input('long'));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(call.result).toEqual({ ok: false, reason: 'timeout' });
  });

  it('maxConcurrent caps in-flight classify calls', async () => {
    const run = (maxConcurrent: number | undefined, calls: number) => {
      let active = 0;
      let maxActive = 0;
      const fetch = vi.fn<JevFetch>(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await delay(20);
        active--;
        return new Response(JSON.stringify(noulBody('long', [0.9, 0.8, 0.7])), { status: 200 });
      });
      const client = makeClient(fetch, { maxConcurrent });
      const results = Array.from({ length: calls }, () => client.classify(input('long')));
      return Promise.all(results).then((rs) => ({ maxActive, results: rs }));
    };

    const one = await run(1, 3);
    expect(one.maxActive).toBe(1);
    expect(one.results.every((r) => r.result.ok)).toBe(true);

    const two = await run(2, 4);
    expect(two.maxActive).toBe(2);
    expect(two.results.every((r) => r.result.ok)).toBe(true);

    const unlimited = await run(undefined, 3);
    expect(unlimited.maxActive).toBe(3);
    expect(unlimited.results.every((r) => r.result.ok)).toBe(true);
  });

  it('maxConcurrent 1: a waiting call does not spend its timeout budget', async () => {
    const fetch = vi.fn<JevFetch>()
      .mockImplementationOnce(async () => {
        await delay(120);
        return new Response(JSON.stringify(noulBody('long', [0.9, 0.8, 0.7])), { status: 200 });
      })
      .mockImplementationOnce(async () => {
        // 120 ms queued + 100 ms here is over the 150 ms budget, so only a budget that starts at the slot passes.
        await delay(100);
        return new Response(JSON.stringify(noulBody('long', [0.9, 0.8, 0.7])), { status: 200 });
      });
    const client = makeClient(fetch, { timeoutMs: 150, maxConcurrent: 1 });
    const [a, b] = await Promise.all([client.classify(input('long')), client.classify(input('long'))]);

    expect(a.result.ok).toBe(true);
    expect(b.result.ok).toBe(true);
  });

  it('maxConcurrent 1: a slot is released when a call fails', async () => {
    const fetch = vi.fn<JevFetch>()
      .mockImplementationOnce(reply(500, {}))
      .mockImplementation(reply(200, noulBody('long', [0.9, 0.8, 0.7])));
    const client = makeClient(fetch, { maxConcurrent: 1 });

    const first = await client.classify(input('long'));
    expect(first.result.ok).toBe(false);

    const second = await client.classify(input('long'));
    expect(second.result.ok).toBe(true);

    const [c, d] = await Promise.all([client.classify(input('long')), client.classify(input('long'))]);
    expect(c.result.ok).toBe(true);
    expect(d.result.ok).toBe(true);
  });
});
