/**
 * Ticket F03 proof on Binance Demo Trading: the funding-ops adapter against the
 * real Demo REST API — income query and fee-burn reads (GET /fapi/v1/income,
 * GET /fapi/v1/feeBurn, GET /sapi/v1/bnbBurn).
 *
 * What Demo does NOT support (verified against plan S08 notes; the universal
 * transfer and Simple Earn endpoints are production-wallet APIs): POST
 * /sapi/v1/asset/transfer and /sapi/v1/simple-earn/* are covered by the mocked
 * unit suite (test/funding-ops.test.ts), together with the money-ops guard.
 * The burn toggles are asserted read-only here; flipping them would change the
 * shared Demo account, which the suite avoids.
 *
 * Keys come from git-ignored apps/server/.env and are never printed. Not part
 * of `pnpm test` or CI: run with `pnpm --filter @cane/server test:integration`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENDPOINTS } from '../../src/binance/endpoints.js';
import { BinanceRestClient, type BinanceCredentials, type HttpFn } from '../../src/binance/rest.client.js';
import { BinanceFundingOps } from '../../src/binance/funding-ops.js';

const ENV_FILE = fileURLToPath(new URL('../../.env', import.meta.url));
const env = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {};

function credsFrom(apiKey: string | undefined, apiSecret: string | undefined): BinanceCredentials | null {
  return apiKey && apiSecret ? { apiKey, apiSecret } : null;
}
const spotCreds = credsFrom(env.BINANCE_SPOT_TESTNET_KEY, env.BINANCE_SPOT_TESTNET_SECRET);
const futuresCreds = credsFrom(env.BINANCE_FUTURES_TESTNET_KEY, env.BINANCE_FUTURES_TESTNET_SECRET);

const http: HttpFn = (url, init) => fetch(url, init);
const SYMBOL = 'BTCUSDT';
const DAY_MS = 24 * 60 * 60 * 1000;

// The Demo account may never have traded in the window: the proof is a well-formed
// response (an array), not non-empty rows.
describe.skipIf(!futuresCreds)('F03 funding ops on Demo (USDⓈ-M)', () => {
  let ops: BinanceFundingOps;
  beforeAll(() => {
    const rest = new BinanceRestClient(ENDPOINTS.testnet, () => futuresCreds!, http);
    // moneyOpsEnabled=false: this suite only ever queries — a Demo-side toggle
    // would mutate the shared account.
    ops = new BinanceFundingOps(rest, false);
  });

  it('GET /fapi/v1/income answers the 7-day funding + commission window', async () => {
    const to = Date.now();
    const from = to - 7 * DAY_MS;
    const rows = await ops.income({ symbol: SYMBOL, incomeTypes: ['FUNDING_FEE', 'COMMISSION'], from, to });
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows) {
      expect(r.symbol).toBe(SYMBOL);
      expect(['FUNDING_FEE', 'COMMISSION']).toContain(r.incomeType);
      expect(r.asset).toBe('USDT');
    }
  }, 60_000);

  it('GET /fapi/v1/feeBurn returns a boolean', async () => {
    expect(typeof await ops.getFeeBurn()).toBe('boolean');
  }, 30_000);
});

describe.skipIf(!spotCreds)('F03 funding ops on Demo (spot)', () => {
  let ops: BinanceFundingOps;
  beforeAll(() => {
    const rest = new BinanceRestClient(ENDPOINTS.testnet, () => spotCreds!, http);
    ops = new BinanceFundingOps(rest, false);
  });

  it('GET /sapi/v1/bnbBurn returns the spot burn flags', async () => {
    const s = await ops.getBnbBurn();
    expect(typeof s.spotBNBBurn).toBe('boolean');
    expect(typeof s.interestBNBBurn).toBe('boolean');
  }, 30_000);
});
