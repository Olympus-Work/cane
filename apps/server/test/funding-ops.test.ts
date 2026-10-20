import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { BinanceMarket } from '../src/binance/endpoints.js';
import type { Auth, BinanceRestClient, Params, RetryMode } from '../src/binance/rest.client.js';
import { BinanceFundingOps, MoneyOpsDisabledError, type UniversalTransferType } from '../src/binance/funding-ops.js';

type Call = { market: string; method: string; path: string; params: Record<string, unknown>; auth: string; retry: string };

function fakeRest(handler: (c: Call) => unknown) {
  const calls: Call[] = [];
  const rest = {
    request: async (
      market: BinanceMarket,
      method: 'GET' | 'POST' | 'PUT' | 'DELETE',
      path: string,
      params: Params,
      auth: Auth,
      retry: RetryMode,
    ) => {
      const c: Call = { market, method, path, params, auth, retry };
      calls.push(c);
      const r = handler(c);
      if (r instanceof Error) throw r;
      return r;
    },
  } as unknown as BinanceRestClient;
  return { rest, calls };
}

const noSleep = async () => {};
const TRANSFER_TYPE: UniversalTransferType = 'MAIN_UMFUTURE';

describe('BinanceFundingOps.transfer', () => {
  it('refuses to move money when disabled and sends nothing', async () => {
    const { rest, calls } = fakeRest(() => ({}));
    const ops = new BinanceFundingOps(rest, false, noSleep);
    await expect(ops.transfer({ type: TRANSFER_TYPE, asset: 'USDT', amount: new Decimal('10') })).rejects.toBeInstanceOf(MoneyOpsDisabledError);
    await expect(ops.earnRedeem({ productId: 'p' })).rejects.toBeInstanceOf(MoneyOpsDisabledError);
    await expect(ops.setBnbBurn({ spotBNBBurn: true })).rejects.toBeInstanceOf(MoneyOpsDisabledError);
    await expect(ops.setFeeBurn(true)).rejects.toBeInstanceOf(MoneyOpsDisabledError);
    expect(calls.length).toBe(0);
  });

  it('rejects an unknown type or a non-positive amount before any request', async () => {
    const { rest, calls } = fakeRest(() => ({}));
    const ops = new BinanceFundingOps(rest, true, noSleep);
    await expect(ops.transfer({ type: 'MAIN_MARGIN' as UniversalTransferType, asset: 'USDT', amount: new Decimal('1') })).rejects.toThrow(/unsupported type/);
    await expect(ops.transfer({ type: TRANSFER_TYPE, asset: 'USDT', amount: new Decimal('0') })).rejects.toThrow(/must be > 0/);
    expect(calls.length).toBe(0);
  });

  it('posts signed once with clientTranId and parses tranId', async () => {
    const { rest, calls } = fakeRest((c) => {
      if (c.method === 'POST') return { tranId: 7415 } as never;
      return {};
    });
    const ops = new BinanceFundingOps(rest, true, noSleep);
    const res = await ops.transfer({ type: TRANSFER_TYPE, asset: 'USDT', amount: new Decimal('25.5'), clientTranId: 'arb-rebalance-1' });
    expect(res).toEqual({ tranId: 7415 });
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe('/sapi/v1/asset/transfer');
    expect(post.auth).toBe('signed');
    expect(post.retry).toBe('once');
    expect(post.params).toMatchObject({ type: 'MAIN_UMFUTURE', asset: 'USDT', amount: '25.5', clientTranId: 'arb-rebalance-1' });
  });

  it('queries the history until the tranId is found across pages', async () => {
    const { rest, calls } = fakeRest((c) => {
      if (Number(c.params.currentPage ?? 1) === 2) {
        return { rows: [{ tranId: 7415, type: 'MAIN_UMFUTURE', asset: 'USDT', amount: '25.5', status: 'CONF', timestamp: 1700000000000 }], total: 2 };
      }
      return { rows: [{ tranId: 7000, type: 'MAIN_UMFUTURE', asset: 'USDT', amount: '1', status: 'CONF', timestamp: 1699999000000 }], total: 2 };
    });
    const ops = new BinanceFundingOps(rest, true, noSleep);
    const rec = await ops.queryTransfer({ type: TRANSFER_TYPE, tranId: 7415 });
    expect(rec).not.toBeNull();
    expect(rec!.status).toBe('CONF');
    expect(rec!.amount.toString()).toBe('25.5');
    expect(calls.filter((c) => c.method === 'GET').length).toBe(2);
  });

  it('returns null while the transfer is not in history yet', async () => {
    const { rest } = fakeRest(() => ({ rows: [], total: 0 }));
    const ops = new BinanceFundingOps(rest, true, noSleep);
    expect(await ops.queryTransfer({ type: TRANSFER_TYPE, tranId: 42 })).toBeNull();
  });
});

describe('BinanceFundingOps fee burn', () => {
  it('reads spot and perp settings', async () => {
    const { rest, calls } = fakeRest((c) => {
      if (c.path === '/sapi/v1/bnbBurn') return { spotBNBBurn: true, interestBNBBurn: false };
      if (c.path === '/fapi/v1/feeBurn') return { feeBurn: true };
      return {};
    });
    const ops = new BinanceFundingOps(rest, true, noSleep);
    expect(await ops.getBnbBurn()).toEqual({ spotBNBBurn: true, interestBNBBurn: false });
    expect(await ops.getFeeBurn()).toBe(true);
    expect(calls.find((c) => c.path === '/fapi/v1/feeBurn')!.market).toBe('futures');
  });

  it('assertFeeBurnEnabled turns both on and reports what changed (B22)', async () => {
    const state = { spot: false, perp: false };
    const { rest, calls } = fakeRest((c) => {
      const key = c.method + ' ' + c.path;
      if (key === 'GET /sapi/v1/bnbBurn') return { spotBNBBurn: state.spot, interestBNBBurn: false };
      if (key === 'POST /sapi/v1/bnbBurn') {
        state.spot = c.params.spotBNBBurn === 'true';
        return { spotBNBBurn: state.spot, interestBNBBurn: false };
      }
      if (key === 'GET /fapi/v1/feeBurn') return { feeBurn: state.perp };
      if (key === 'POST /fapi/v1/feeBurn') {
        state.perp = c.params.feeBurn === 'true';
        return { feeBurn: state.perp };
      }
      return {};
    });
    const ops = new BinanceFundingOps(rest, true, noSleep);
    expect(await ops.assertFeeBurnEnabled()).toEqual({ spotBNBBurn: true, feeBurn: true, changedSpot: true, changedPerp: true });
    expect(await ops.assertFeeBurnEnabled()).toEqual({ spotBNBBurn: true, feeBurn: true, changedSpot: false, changedPerp: false });
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts.length).toBe(2);
    expect(posts[0]!.params.interestBNBBurn).toBeUndefined(); // left as-is
  });
});

describe('BinanceFundingOps.income', () => {
  it('queries each incomeType, merges ascending and keeps the symbol filter', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const from = Date.parse('2026-09-01T00:00:00Z');
    const to = from + 40 * DAY; // crosses the 30-day window bound
    const { rest, calls } = fakeRest((c) => {
      const type = c.params.incomeType;
      const t = Number(c.params.startTime) + 1_000;
      return [{ symbol: 'BTCUSDT', incomeType: type, asset: 'USDT', amount: type === 'FUNDING_FEE' ? '0.5' : '-0.01', time: t }];
    });
    const ops = new BinanceFundingOps(rest, true, noSleep);
    const rows = await ops.income({ symbol: 'BTCUSDT', incomeTypes: ['FUNDING_FEE', 'COMMISSION'], from, to });
    expect(rows.length).toBe(4); // two types x two 30-day windows
    expect(rows.every((r) => r.symbol === 'BTCUSDT')).toBe(true);
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.time).toBeGreaterThanOrEqual(rows[i - 1]!.time);
    const paths = new Set(calls.map((c) => c.path));
    expect(paths).toEqual(new Set(['/fapi/v1/income']));
    expect(calls.every((c) => c.market === 'futures' && c.auth === 'signed' && c.retry === 'safe')).toBe(true);
  });

  it('pages a full window by the last time and stops at a short page', async () => {
    const from = Date.parse('2026-09-01T00:00:00Z');
    const to = from + 5 * 60 * 60 * 1000;
    let page = 0;
    const { rest } = fakeRest(() => {
      page += 1;
      if (page === 1) {
        return Array.from({ length: 1000 }, (_, i) => ({ symbol: 'BTCUSDT', incomeType: 'FUNDING_FEE', asset: 'USDT', amount: '0.1', time: from + i }));
      }
      return [{ symbol: 'BTCUSDT', incomeType: 'FUNDING_FEE', asset: 'USDT', amount: '0.2', time: from + 2000 }];
    });
    const ops = new BinanceFundingOps(rest, true, noSleep);
    const rows = await ops.income({ incomeTypes: ['FUNDING_FEE'], from, to });
    expect(rows.length).toBe(1001);
  });

  it('rejects an empty type list or a backwards window', async () => {
    const { rest, calls } = fakeRest(() => []);
    const ops = new BinanceFundingOps(rest, true, noSleep);
    await expect(ops.income({ incomeTypes: [], from: 1, to: 2 })).rejects.toThrow(/no incomeType/);
    await expect(ops.income({ incomeTypes: ['FUNDING_FEE'], from: 5, to: 5 })).rejects.toThrow(/after start/);
    expect(calls.length).toBe(0);
  });
});

describe('BinanceFundingOps Simple Earn', () => {
  it('lists positions paged by total', async () => {
    const { rest, calls } = fakeRest((c) => {
      if (Number(c.params.currentPage ?? 1) === 2) return { rows: [{ productId: 'p2', asset: 'BNB', amount: '0.5' }], total: 2 };
      return { rows: [{ productId: 'p1', asset: 'BNB', amount: '1.5' }], total: 2 };
    });
    const ops = new BinanceFundingOps(rest, true, noSleep);
    const positions = await ops.earnPositions('BNB');
    expect(positions).toEqual([
      { productId: 'p1', asset: 'BNB', amount: new Decimal('1.5') },
      { productId: 'p2', asset: 'BNB', amount: new Decimal('0.5') },
    ]);
    expect(calls.length).toBe(2);
    expect(calls[1]!.params.currentPage).toBe(2);
  });

  it('redeems with once-retry semantics and amount omitted = full position', async () => {
    const { rest, calls } = fakeRest(() => ({ redeemId: 1, amount: '1.5', success: true }));
    const ops = new BinanceFundingOps(rest, true, noSleep);
    const res = await ops.earnRedeem({ productId: 'p1' });
    expect(res.amount!.toString()).toBe('1.5');
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe('/sapi/v1/simple-earn/flexible/redeem');
    expect(post.retry).toBe('once');
    expect(post.params.amount).toBeUndefined();
  });

  it('throws when Binance reports success:false', async () => {
    const { rest } = fakeRest(() => ({ success: false }));
    const ops = new BinanceFundingOps(rest, true, noSleep);
    await expect(ops.earnRedeem({ productId: 'p1', amount: new Decimal('1') })).rejects.toThrow(/redeem refused/);
  });

  it('money-disabled path: redeem refused without any request (checked above) and query stays safe', async () => {
    const { rest, calls } = fakeRest(() => ({ rows: [], total: 0 }));
    const ops = new BinanceFundingOps(rest, false, noSleep);
    expect((await ops.earnPositions('BNB')).length).toBe(0);
    expect(calls.length).toBe(1); // read-only query is allowed
  });
});
