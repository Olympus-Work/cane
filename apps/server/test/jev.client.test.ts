import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Decimal } from 'decimal.js';
import { FACTOR_NAMES, presentFactorCount, type ConfluenceFeatures, type Side } from '@cane/core';
import { JEV_MODEL, JEV_URL, MAX_STORED_BODY_CHARS, JevClient, serialiseState, type JevFetch } from '../src/jev/jev.client.js';
import { UnavailableJev } from '../src/engine/ports.js';

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

function client(fetch: JevFetch, timeoutMs = 3000) {
  let t = 1000;
  return new JevClient({ apiKey: KEY, fetch, now: () => (t += 7), timeoutMs });
}

const input = (side: Side) => ({ side, timeframe: '1d' as const, features: features(side) });

describe('JevClient (AC9)', () => {
  it('valid: maps the three Noul answers back in factor order and sends the pinned model', async () => {
    const fetch = vi.fn<JevFetch>(reply(200, noulBody('long', [0.95, 0.2, 0.7])));
    const call = await client(fetch).classify(input('long'));

    expect(call.result).toEqual({
      ok: true,
      factors: [
        { present: true, confidence: 0.95 },
        { present: false, confidence: 0.2 },
        { present: true, confidence: 0.7 },
      ],
    });
    expect(call.error).toBeNull();
    expect(call.model).toBe(JEV_MODEL);
    expect(call.latencyMs).toBe(7);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(JEV_URL);
    expect(init.headers.authorization).toBe(`Bearer ${KEY}`);
    const sent = JSON.parse(init.body) as { model: string; state: string; questions: Record<string, { type: string }> };
    expect(sent.model).toBe('jev-1.13.0');
    expect(Object.keys(sent.questions)).toEqual([...FACTOR_NAMES.long]);
    expect(Object.values(sent.questions).every((q) => q.type === 'noul')).toBe(true);
    expect(sent.state).toBe(serialiseState(features('long')));
  });

  it('short side asks the mirrored factors', async () => {
    const fetch = vi.fn<JevFetch>(reply(200, noulBody('short', [0.1, 0.9, 0.9])));
    const call = await client(fetch).classify(input('short'));
    expect(call.result.ok).toBe(true);
    expect(Object.keys((JSON.parse(fetch.mock.calls[0]![1].body) as { questions: object }).questions)).toEqual(['channel_breakdown', 'euphoria', 'lower_high']);
  });

  it('the strategy threshold decides through confidence', async () => {
    const call = await client(reply(200, noulBody('long', [0.6, 0.8, 0.9]))).classify(input('long'));
    expect(presentFactorCount(call.result, 0.7)).toBe(2);
    expect(presentFactorCount(call.result, 0.5)).toBe(3);
  });

  it('timeout: a call that never answers gives reason timeout after the budget', async () => {
    const never: JevFetch = () => new Promise<Response>(() => undefined);
    const call = await client(never, 30).classify(input('long'));
    expect(call.result).toEqual({ ok: false, reason: 'timeout' }); expect(presentFactorCount(call.result)).toBe(0); // B8.4: base size
    expect(call.error).toMatch(/30 ms/);
  });

  it('timeout: the request is aborted', async () => {
    let signal: AbortSignal | undefined;
    const slow: JevFetch = (_u, init) => {
      signal = init.signal;
      return new Promise<Response>((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    };
    const call = await client(slow, 30).classify(input('long'));
    expect(call.result).toEqual({ ok: false, reason: 'timeout' }); expect(presentFactorCount(call.result)).toBe(0); // B8.4: base size
    expect(signal?.aborted).toBe(true);
  });

  it.each([500, 503, 429, 401])('HTTP %i is an error, response kept', async (status) => {
    const call = await client(reply(status, { error: 'nope' })).classify(input('long'));
    expect(call.result).toEqual({ ok: false, reason: 'error' }); expect(presentFactorCount(call.result)).toBe(0); // B8.4: base size
    expect(call.error).toBe(`HTTP ${status}`);
    expect(call.response).toEqual({ error: 'nope' });
  });

  it('a network failure is an error and the message never carries the key', async () => {
    const boom: JevFetch = async () => {
      throw new TypeError(`fetch failed for Bearer ${KEY}`);
    };
    const call = await client(boom).classify(input('long'));
    expect(call.result).toEqual({ ok: false, reason: 'error' }); expect(presentFactorCount(call.result)).toBe(0); // B8.4: base size
    expect(JSON.stringify(call)).not.toContain(KEY);
  });

  it.each<[string, unknown]>([
    ['not JSON', 'oops <html>'],
    ['no answers', { model: JEV_MODEL }],
    ['missing a factor', { answers: { channel_breakout: { type: 'noul', noul: 0.9 }, capitulation: { type: 'noul', noul: 0.9 } } }],
    ['wrong type', { answers: { channel_breakout: { type: 'choice', noul: 0.9 }, capitulation: { type: 'noul', noul: 0.9 }, higher_low: { type: 'noul', noul: 0.9 } } }],
    ['noul above 1', noulBody('long', [1.2, 0.5, 0.5])],
    ['noul negative', noulBody('long', [-0.1, 0.5, 0.5])],
    ['noul a string', { answers: { channel_breakout: { type: 'noul', noul: '0.9' }, capitulation: { type: 'noul', noul: 0.9 }, higher_low: { type: 'noul', noul: 0.9 } } }],
  ])('invalid shape (%s) is invalid_response', async (_label, body) => {
    const call = await client(reply(200, body)).classify(input('long'));
    expect(call.result).toEqual({ ok: false, reason: 'invalid_response' }); expect(presentFactorCount(call.result)).toBe(0); // B8.4: base size
    expect(call.response).toEqual(body);
  });

  it('cuts a huge non-JSON body before it is stored', async () => {
    const call = await client(reply(502, 'x'.repeat(MAX_STORED_BODY_CHARS * 5))).classify(input('long'));
    expect(call.result).toEqual({ ok: false, reason: 'error' });
    expect(call.response).toBe('x'.repeat(MAX_STORED_BODY_CHARS));
  });

  it('never stores the key in the request it returns', async () => {
    const call = await client(reply(200, noulBody('long', [0.5, 0.5, 0.5]))).classify(input('long'));
    expect(JSON.stringify(call.request)).not.toContain(KEY);
  });

  it('serialises features to fixed text, with nulls spelled out', () => {
    const f = features('long');
    expect(serialiseState(f)).toBe(
      [
        'side: long',
        'timeframe: 1d',
        'channel.pivot_count: 4',
        'channel.slope_pct_per_bar: -0.35',
        'channel.touches: 3',
        'channel.close_beyond_line_pct: 1.2',
        'exhaustion.longest_big_body_run: 2',
        'exhaustion.gap_count: 1',
        'exhaustion.volume_spike_ratio: 2.5',
        'swing.change_pct: 4.1',
        'swing.bars_apart: 18',
      ].join('\n'),
    );
    const sparse: ConfluenceFeatures = { ...f, channel: { ...f.channel, slopePctPerBar: null, closeBeyondPct: null }, swing: { changePct: null, barsApart: null } };
    expect(serialiseState(sparse)).toContain('channel.slope_pct_per_bar: none');
    expect(serialiseState(sparse)).toContain('swing.bars_apart: none');
  });

  it('without a key the engine keeps the B8.4 fallback', async () => {
    const call = await new UnavailableJev().classify();
    expect(call.result).toEqual({ ok: false, reason: 'error' }); expect(presentFactorCount(call.result)).toBe(0); // B8.4: base size
  });
});
