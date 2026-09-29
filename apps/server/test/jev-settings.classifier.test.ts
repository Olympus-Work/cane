import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Decimal } from 'decimal.js';
import { FACTOR_NAMES, type ConfluenceFeatures, type Side } from '@cane/core';
import { JEV_MODEL, type JevFetch } from '../src/jev/jev.client.js';
import type { SettingsService } from '../src/settings/settings.service.js';
import { SettingsJevClassifier } from '../src/jev/jev-settings.classifier.js';

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

const input = { side: 'long' as const, timeframe: '1d' as const, features: features('long') };

interface FakeSettings {
  secrets: Record<string, string>;
  timeout: number | null;
  service: SettingsService;
}

function fakeSettings(secrets: Record<string, string> = {}, timeout: number | null = null): FakeSettings {
  const service = {
    getSecret: async (k: string) => secrets[k] ?? null,
    getJevTimeoutMs: async () => timeout,
  } as unknown as SettingsService;
  return { secrets, timeout, service };
}

function classifier(settings: SettingsService, fetch: JevFetch, envKey?: string) {
  return new SettingsJevClassifier(settings, fetch, () => Date.now(), { maxRetries: 0, maxConcurrent: 0 }, envKey);
}

describe('SettingsJevClassifier', () => {
  it('falls back to UnavailableJev when no key is configured', async () => {
    const fetch = vi.fn<JevFetch>(reply(200, noulBody('long', [0.9, 0.9, 0.9])));
    const c = classifier(fakeSettings().service, fetch);

    const call = await c.classify(input);
    expect(call.result).toEqual({ ok: false, reason: 'error' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends the settings key as a Bearer token', async () => {
    const fetch = vi.fn<JevFetch>(reply(200, noulBody('long', [0.9, 0.9, 0.9])));
    const settings = fakeSettings({ jev_api_key: 'fixture-jev-key' });
    const c = classifier(settings.service, fetch);

    const call = await c.classify(input);
    expect(call.result.ok).toBe(true);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers.authorization).toBe('Bearer fixture-jev-key');
  });

  it('prefers the settings key over the env key, and uses the env key when the setting is absent', async () => {
    const fetch = vi.fn<JevFetch>(reply(200, noulBody('long', [0.9, 0.9, 0.9])));
    const withSettings = fakeSettings({ jev_api_key: 'settings-key' });
    await classifier(withSettings.service, fetch, 'env-key').classify(input);
    expect(fetch.mock.calls[0]?.[1]?.headers.authorization).toBe('Bearer settings-key');

    const envOnly = fakeSettings();
    await classifier(envOnly.service, fetch, 'env-key').classify(input);
    expect(fetch.mock.calls[1]?.[1]?.headers.authorization).toBe('Bearer env-key');
  });

  it('picks up a changed key on the next call without a new classifier', async () => {
    const fetch = vi.fn<JevFetch>(reply(200, noulBody('long', [0.9, 0.9, 0.9])));
    const settings = fakeSettings({ jev_api_key: 'key-a' });
    const c = classifier(settings.service, fetch);

    await c.classify(input);
    expect(fetch.mock.calls[0]?.[1]?.headers.authorization).toBe('Bearer key-a');

    settings.secrets['jev_api_key'] = 'key-b';
    await c.classify(input);
    expect(fetch.mock.calls[1]?.[1]?.headers.authorization).toBe('Bearer key-b');
  });

  it('honours the timeout Setting; a hung fetch becomes a timeout', async () => {
    const hanging: JevFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    const settings = fakeSettings({ jev_api_key: 'fixture-jev-key' }, 50);
    const c = classifier(settings.service, hanging);

    const started = Date.now();
    const call = await c.classify(input);
    expect(call.result).toEqual({ ok: false, reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('uses the 3000 ms default when the timeout Setting is unset', async () => {
    const fetch = vi.fn<JevFetch>(reply(200, noulBody('long', [0.9, 0.9, 0.9])));
    const settings = fakeSettings({ jev_api_key: 'fixture-jev-key' }, null);
    const c = classifier(settings.service, fetch);

    const call = await c.classify(input);
    expect(call.result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reuses the client while key and timeout are unchanged', async () => {
    const fetch = vi.fn<JevFetch>(reply(200, noulBody('long', [0.9, 0.9, 0.9])));
    const settings = fakeSettings({ jev_api_key: 'fixture-jev-key' });
    const c = classifier(settings.service, fetch);

    const first = await c.classify(input);
    const second = await c.classify(input);
    expect(first.result.ok).toBe(true);
    expect(second.result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
