/**
 * Plan S07 proof: one live Jev call with real BTCUSDT daily features.
 * The key comes from the git-ignored apps/server/.env and is never printed.
 * Not part of `pnpm test` or CI: run with `pnpm --filter @cane/server test:integration`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { confluenceFeatures } from '@cane/core';
import { describe, expect, it } from 'vitest';
import { JEV_MODEL, JevClient } from '../../src/jev/jev.client.js';
import { parseKline } from '../../src/market-data/klines.client.js';

const ENV_FILE = fileURLToPath(new URL('../../.env', import.meta.url));
const env = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {};
const apiKey = env.TYPESAFE_API_KEY;

describe.skipIf(!apiKey)('Jev live call (S07)', () => {
  it.each(['long', 'short'] as const)('answers three Noul questions for BTCUSDT 1D, %s side', async (side) => {
    const res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=200');
    const rows = (await res.json()) as unknown[];
    const candles = rows.map(parseKline).slice(0, -1); // drop the still-open candle (only closed candles are evaluated)
    const features = confluenceFeatures(candles, candles.length - 1, side);

    const jev = new JevClient({ apiKey: apiKey!, fetch: (url, init) => fetch(url, init), now: Date.now });
    const call = await jev.classify({ side, timeframe: '1d', features });

    // Facts for the PR: no key, no account data.
    console.log(JSON.stringify({ side, ok: call.result.ok, model: call.model, latencyMs: call.latencyMs, error: call.error, factors: call.result.ok ? call.result.factors : null }));
    expect(call.error).toBeNull();
    expect(call.result.ok).toBe(true);
    expect(call.model).toBe(JEV_MODEL);
  });
});
