import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { BinanceMarket } from '../src/binance/endpoints.js';
import { BinanceError, UnknownOutcomeError, type Auth, type BinanceRestClient, type Params, type RetryMode } from '../src/binance/rest.client.js';
import { BinanceFundingOps, MoneyOpsDisabledError, type UniversalTransferType } from '../src/binance/funding-ops.js';

/**
 * Mock bodies are copied verbatim from developers.binance.com (PR #43 review:
 * the first suite passed on shapes that were wrong together with the mocks).
 */

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
const TYPE: UniversalTransferType = 'MAIN_UMFUTURE';

describe('BinanceFundingOps.transfer', () => {
  it('refuses to move money when disabled and sends nothing', async () => {
    const { rest, calls } = fakeRest(() => ({}));
    const ops = new BinanceFundingOps(rest, false, noSleep);
    await expect(ops.transfer({ type: TYPE, asset: 'USDT', amount: new Decimal('10') })).rejects.toBeInstanceOf(MoneyOpsDisabledError);
    await expect(ops.earnRedeem({ productId: 'p', redeemAll: true })).rejects.toBeInstanceOf(MoneyOpsDisabledError);
    await expect(ops.setBnbBurn({ spotBNBBurn: true })).rejects.toBeInstanceOf(MoneyOpsDisabledError);
    await expect(ops.setFeeBurn(true)).rejects.toBeInstanceOf(MoneyOpsDisabledError);
    expect(calls.length).toBe(0);
  });

  it('rejects an unknown type or a non-positive amount before any request', async () => {
    const { rest, calls } = fakeRest(() => ({}));
    const ops = new BinanceFundingOps(rest, true, noSleep);
    await expect(ops.transfer({ type: 'MAIN_MARGIN' as UniversalTransferType, asset: 'USDT', amount: new Decimal('1') })).rejects.toThrow(/unsupported type/);
    await expect(ops.transfer({ type: TYPE, asset: 'USDT', amount: new Decimal('0') })).rejects.toThrow(/must be > 0/);
    expect(calls.length).toBe(0);
  });

  it('posts signed once with the documented params only and parses tranId', async () => {
    const { rest, calls } = fakeRest(() => ({ tranId: 8216583549 })); // docs shape: {tranId}
    const ops = new BinanceFundingOps(rest, true, noSleep);
    const res = await ops.transfer({ type: TYPE, asset: 'USDT', amount: new Decimal('25.5') });
    expect(res).toEqual({ tranId: 8216583549 });
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe('/sapi/v1/asset/transfer');
    expect(post.auth).toBe('signed');
    expect(post.retry).toBe('once');
    // The endpoint has no clientTranId parameter (review item 6).
    expect(post.params).toEqual({ type: 'MAIN_UMFUTURE', asset: 'USDT', amount: '25.5' });
  });

  it('queryTransfer pages with current/size over a total above one page (docs example rows)', async () => {
    // Docs example: status CONFIRMED; total above one page exercises paging.
    const page1 = {
      total: 3,
      rows: [
        { asset: 'USDT', amount: '1', type: 'MAIN_UMFUTURE', status: 'CONFIRMED', tranId: 11415955596, timestamp: 1544433328000 },
        { asset: 'USDT', amount: '2', type: 'MAIN_UMFUTURE', status: 'CONFIRMED', tranId: 11366865406, timestamp: 1544433328000 },
      ],
    };
    const page2 = {
      total: 3,
      rows: [{ asset: 'USDT', amount: '3', type: 'MAIN_UMFUTURE', status: 'PENDING', tranId: 9999999, timestamp: 1544433329000 }],
    };
    const { rest, calls } = fakeRest((c) => (Number(c.params.current) === 1 ? page1 : page2));
    const ops = new BinanceFundingOps(rest, true, noSleep);
    const rec = await ops.queryTransfer({ type: TYPE, tranId: 9999999, from: 1544000000000 });
    expect(rec!.status).toBe('PENDING');
    const get = calls.find((c) => c.method === 'GET')!;
    expect(get.params).toMatchObject({ type: 'MAIN_UMFUTURE', current: 1, size: 100, startTime: 1544000000000 });
    expect(get.params.currentPage).toBeUndefined();
    expect(get.params.limit).toBeUndefined();
  });

  it('queryTransfer requires from: the 7-day default window must not read as "not found" (re-review item 4)', async () => {
    const { rest } = fakeRest(() => ({ total: 0, rows: [] }));
    const ops = new BinanceFundingOps(rest, true, noSleep);
    // @ts-expect-error from is required — no implicit 7-day default for a lost-transfer lookup
    await expect(ops.queryTransfer({ type: TYPE, tranId: 42 })).rejects.toThrow(/from is required/);
  });

  it('stops paging when the server repeats page 1 (ignores current): no spin, still finds nothing', async () => {
    const repeated = { total: 200, rows: [{ asset: 'USDT', amount: '1', type: 'MAIN_UMFUTURE', status: 'CONFIRMED', tranId: 1, timestamp: 1 }] };
    const { rest, calls } = fakeRest(() => repeated);
    const ops = new BinanceFundingOps(rest, true, noSleep);
    expect(await ops.queryTransfer({ type: TYPE, tranId: 42, from: 0 })).toBeNull();
    expect(calls.length).toBe(2); // one page, then the no-new-rows stop
  });

  it('findTransfers resolves the lost-response case by asset+amount+time', async () => {
    const { rest } = fakeRest(() => ({
      total: 2,
      rows: [
        { asset: 'USDT', amount: '25.5', type: 'MAIN_UMFUTURE', status: 'CONFIRMED', tranId: 7, timestamp: 2000 },
        { asset: 'USDT', amount: '99', type: 'MAIN_UMFUTURE', status: 'CONFIRMED', tranId: 8, timestamp: 2001 },
      ],
    }));
    const ops = new BinanceFundingOps(rest, true, noSleep);
    const hits = await ops.findTransfers({ type: TYPE, asset: 'USDT', amount: new Decimal('25.5'), sinceMs: 1500 });
    expect(hits.length).toBe(1);
    expect(hits[0]!.tranId).toBe(7);
  });

  it('an unclear transfer is surfaced, never resent by the client', async () => {
    const { rest, calls } = fakeRest(() => new UnknownOutcomeError('POST /sapi/v1/asset/transfer', 'fetch failed'));
    const ops = new BinanceFundingOps(rest, true, noSleep);
    await expect(ops.transfer({ type: TYPE, asset: 'USDT', amount: new Decimal('5') })).rejects.toBeInstanceOf(UnknownOutcomeError);
    expect(calls.length).toBe(1); // the client retried nothing
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

  it('setFeeBurn confirms with GET because the POST answers {code,msg} only (review item 2)', async () => {
    let state = false;
    const { rest, calls } = fakeRest((c) => {
      const key = c.method + ' ' + c.path;
      if (key === 'POST /fapi/v1/feeBurn') {
        state = true;
        return { code: 200, msg: 'success' }; // docs response
      }
      if (key === 'GET /fapi/v1/feeBurn') return { feeBurn: state };
      return {};
    });
    const ops = new BinanceFundingOps(rest, true, noSleep);
    expect(await ops.setFeeBurn(true)).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(['POST', 'GET']);
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
        state.perp = true;
        return { code: 200, msg: 'success' };
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

  it('assertFeeBurnEnabled THROWS when a burn does not stick — no silent success:true (re-review item 1)', async () => {
    // Perp POST succeeds but GET still reports off: the old code claimed both on.
    const { rest } = fakeRest((c) => {
      const key = c.method + ' ' + c.path;
      if (key === 'GET /sapi/v1/bnbBurn') return { spotBNBBurn: true, interestBNBBurn: false };
      if (key === 'GET /fapi/v1/feeBurn') return { feeBurn: false };
      if (key === 'POST /fapi/v1/feeBurn') return { code: 200, msg: 'success' };
      return {};
    });
    const ops = new BinanceFundingOps(rest, true, noSleep);
    await expect(ops.assertFeeBurnEnabled()).rejects.toThrow(/feeBurn still off/);
  });

  it('assertFeeBurnEnabled throws when the spot echo comes back off', async () => {
    const { rest } = fakeRest((c) => {
      const key = c.method + ' ' + c.path;
      if (key === 'GET /sapi/v1/bnbBurn') return { spotBNBBurn: false, interestBNBBurn: false };
      if (key === 'POST /sapi/v1/bnbBurn') return { spotBNBBurn: false, interestBNBBurn: false }; // ignored
      if (key === 'GET /fapi/v1/feeBurn') return { feeBurn: true };
      return {};
    });
    const ops = new BinanceFundingOps(rest, true, noSleep);
    await expect(ops.assertFeeBurnEnabled()).rejects.toThrow(/spotBNBBurn still off/);
  });
});

describe('BinanceFundingOps.income', () => {
  // Docs example rows for GET /fapi/v1/income, verbatim field names (income, not amount).
  const docRowTransfer = {
    symbol: '',
    incomeType: 'TRANSFER',
    income: '-0.37500000',
    asset: 'USDT',
    info: 'TRANSFER',
    time: 1570608000000,
    tranId: 9689322392,
    tradeId: '',
  };
  const docRowCommission = {
    symbol: 'BTCUSDT',
    incomeType: 'COMMISSION',
    income: '-0.01000000',
    asset: 'USDT',
    info: 'COMMISSION',
    time: 1570636800000,
    tranId: 9689322393,
    tradeId: '2059192',
  };

  it('keeps rows that share a tranId across incomeTypes — the key is type:tranId (re-review item 1)', async () => {
    const shared = { ...docRowCommission, tranId: 5, time: 1570636800000 };
    const { rest } = fakeRest((c) => (c.params.incomeType === 'FUNDING_FEE' ? [{ ...shared, incomeType: 'FUNDING_FEE', income: '0.9', info: '' }] : [shared]));
    const ops = new BinanceFundingOps(rest, true, noSleep, () => 1570636800000);
    const rows = await ops.income({ incomeTypes: ['FUNDING_FEE', 'COMMISSION'], from: 1570636700000, to: 1570636800000 });
    expect(rows.length).toBe(2); // one FUNDING_FEE + one COMMISSION, both tranId 5
    expect(new Set(rows.map((r) => r.incomeType))).toEqual(new Set(['FUNDING_FEE', 'COMMISSION']));
  });

  it('pages a server that ignores page by moving the time cursor: 1500 rows, all returned (re-review item)', async () => {
    // Honours startTime/endTime/limit only (the reviewer's simulation shape).
    const universe = Array.from({ length: 1500 }, (_, i) => ({ ...docRowCommission, tranId: 100 + i, time: 1570636800000 + i }));
    const { rest, calls } = fakeRest((c) => {
      const start = Number(c.params.startTime);
      const end = Number(c.params.endTime);
      return universe.filter((r) => r.time >= start && r.time <= end).slice(0, 1000);
    });
    const ops = new BinanceFundingOps(rest, true, noSleep, () => 1570636800000);
    const rows = await ops.income({ incomeTypes: ['COMMISSION'], from: 1570636800000, to: 1570636801499 });
    expect(rows.length).toBe(1500); // no silent truncation at 1000
    expect(calls.length).toBe(2); // page 1 full (cursor moves to last time), page 2 partial (501, incl. the boundary dup) -> stop
    expect(calls[1]!.params.startTime).toBe(1570636800999); // last row time, inclusive
  });

  it('throws instead of truncating when >1000 rows share one timestamp (cursor cannot advance)', async () => {
    const sameTime = Array.from({ length: 1000 }, (_, i) => ({ ...docRowCommission, tranId: i, time: 1570636800000 }));
    const { rest } = fakeRest(() => sameTime);
    const ops = new BinanceFundingOps(rest, true, noSleep, () => 1570636800000);
    await expect(ops.income({ incomeTypes: ['COMMISSION'], from: 1570636800000, to: 1570636801000 })).rejects.toThrow(/paging stalled/);
  });

  it('stops when the server ignores page and repeats the same full page (re-review item 2)', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ ...docRowCommission, tranId: i, time: 1570636800000 + i }));
    const { rest, calls } = fakeRest(() => full); // ignores page AND the time window
    const ops = new BinanceFundingOps(rest, true, noSleep, () => 1570636800000);
    await expect(ops.income({ incomeTypes: ['COMMISSION'], from: 1570636000000, to: 1570636800000 })).rejects.toThrow(/paging stalled/);
    expect(calls.length).toBe(2); // one page, then the stall throw — not an endless loop
  });

  it('parses the documented row shape (income field; symbol/tradeId may be empty)', async () => {
    const { rest } = fakeRest(() => [docRowTransfer, docRowCommission]);
    const ops = new BinanceFundingOps(rest, true, noSleep, () => 1570637000000);
    const rows = await ops.income({ incomeTypes: ['TRANSFER'], from: 1570607000000, to: 1570637000000 });
    expect(rows.length).toBe(2);
    expect(rows[0]!.symbol).toBe('');
    expect(rows[0]!.amount.toString()).toBe('-0.375');
    expect(rows[1]!.tradeId).toBe('2059192');
    expect(rows[1]!.info).toBe('COMMISSION');
  });

  it('dedupes the same tranId across pages', async () => {
    let first = true;
    const { rest } = fakeRest(() => {
      if (first) {
        first = false;
        return Array.from({ length: 1000 }, (_, i) => ({ ...docRowCommission, tranId: i, time: 1570636800000 + i }));
      }
      // Page 2 repeats the first row (same tranId): must not double-count.
      return [{ ...docRowCommission, tranId: 0 }];
    });
    const ops = new BinanceFundingOps(rest, true, noSleep, () => 1570637000000);
    const rows = await ops.income({ incomeTypes: ['COMMISSION'], from: 1570636000000, to: 1570637000000 });
    expect(rows.length).toBe(1000);
  });

  it('merges incomeTypes and sorts ascending by time then tranId', async () => {
    const { rest, calls } = fakeRest((c) => {
      const type = c.params.incomeType;
      return type === 'FUNDING_FEE'
        ? [{ ...docRowTransfer, symbol: 'BTCUSDT', incomeType: 'FUNDING_FEE', income: '0.5', info: '', tranId: 2, time: 2000 }]
        : [{ ...docRowCommission, tranId: 1, time: 1000 }];
    });
    const ops = new BinanceFundingOps(rest, true, noSleep, () => 3000);
    const rows = await ops.income({ symbol: 'BTCUSDT', incomeTypes: ['FUNDING_FEE', 'COMMISSION'], from: 900, to: 3000 });
    expect(rows.map((r) => r.tranId)).toEqual([1, 2]);
    expect(calls.every((c) => c.market === 'futures' && c.auth === 'signed' && c.retry === 'safe')).toBe(true);
    expect(new Set(calls.map((c) => c.path))).toEqual(new Set(['/fapi/v1/income']));
  });

  it('rejects a from older than the 3-month lookback loudly (review item 7)', async () => {
    const { rest, calls } = fakeRest(() => []);
    const ops = new BinanceFundingOps(rest, true, noSleep, () => 1_000_000_000_000);
    await expect(ops.income({ incomeTypes: ['COMMISSION'], from: 1_000_000_000_000 - 200 * 24 * 60 * 60 * 1000, to: 999_999_999_999 })).rejects.toThrow(/older than the 3-month history/);
    expect(calls.length).toBe(0);
  });

  it('rejects an empty type list or a backwards window', async () => {
    const { rest, calls } = fakeRest(() => []);
    const ops = new BinanceFundingOps(rest, true, noSleep);
    await expect(ops.income({ incomeTypes: [], from: 1, to: 2 })).rejects.toThrow(/no incomeType/);
    await expect(ops.income({ incomeTypes: ['COMMISSION'], from: 5, to: 5 })).rejects.toThrow(/after start/);
    expect(calls.length).toBe(0);
  });
});

describe('BinanceFundingOps Simple Earn', () => {
  // Docs example row for flexible position, verbatim field names (totalAmount).
  const docPositionRow = {
    totalAmount: '75.46000000',
    tierAnnualPercentageRate: { '0-5BTC': 0.05, '5-10BTC': 0.03 },
    latestAnnualPercentageRate: '0.02599895',
    yesterdayAirdropPercentageRate: '0.02599895',
    asset: 'USDT',
    airDropAsset: 'BETH',
    canRedeem: true,
    collateralAmount: '232.23123213',
    productId: 'USDT001',
    yesterdayRealTimeRewards: '0.10293829',
    cumulativeBonusRewards: '0.22759183',
    cumulativeRealTimeRewards: '0.22759183',
    cumulativeTotalRewards: '0.45459183',
    autoSubscribe: true,
  };

  it('reads totalAmount and pages with current/size', async () => {
    const { rest, calls } = fakeRest((c) => {
      if (Number(c.params.current) === 2) return { rows: [{ ...docPositionRow, productId: 'p2', totalAmount: '0.5' }], total: 2 };
      return { rows: [{ ...docPositionRow, productId: 'p1', totalAmount: '1.5' }], total: 2 };
    });
    const ops = new BinanceFundingOps(rest, true, noSleep);
    const positions = await ops.earnPositions('BNB');
    expect(positions).toEqual([
      { productId: 'p1', asset: 'USDT', amount: new Decimal('1.5') },
      { productId: 'p2', asset: 'USDT', amount: new Decimal('0.5') },
    ]);
    expect(calls.length).toBe(2);
    expect(calls[1]!.params).toMatchObject({ asset: 'BNB', current: 2, size: 100 });
    expect(calls[0]!.params.currentPage).toBeUndefined();
  });

  it('redeemAll sends redeemAll=true and returns redeemId (docs {redeemId,success})', async () => {
    const { rest, calls } = fakeRest(() => ({ redeemId: 40607, success: true }));
    const ops = new BinanceFundingOps(rest, true, noSleep);
    expect(await ops.earnRedeem({ productId: 'p1', redeemAll: true })).toEqual({ redeemId: 40607 });
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.params).toEqual({ productId: 'p1', redeemAll: 'true' });
    expect(post.retry).toBe('once');
  });

  it('amount path sends the amount and no redeemAll', async () => {
    const { rest, calls } = fakeRest(() => ({ redeemId: 40608, success: true }));
    const ops = new BinanceFundingOps(rest, true, noSleep);
    expect(await ops.earnRedeem({ productId: 'p1', amount: new Decimal('2.5') })).toEqual({ redeemId: 40608 });
    expect(calls.find((c) => c.method === 'POST')!.params).toEqual({ productId: 'p1', amount: '2.5' });
  });

  it('without amount and without redeemAll throws before any request (docs: amount is mandatory)', async () => {
    const { rest, calls } = fakeRest(() => ({}));
    const ops = new BinanceFundingOps(rest, true, noSleep);
    await expect(ops.earnRedeem({ productId: 'p1' })).rejects.toThrow(/amount is mandatory/);
    expect(calls.length).toBe(0);
  });

  it('throws when Binance reports success:false', async () => {
    const { rest } = fakeRest(() => ({ redeemId: 1, success: false }));
    const ops = new BinanceFundingOps(rest, true, noSleep);
    await expect(ops.earnRedeem({ productId: 'p1', redeemAll: true })).rejects.toThrow(/redeem refused/);
  });

  it('money-disabled path: earnPositions (read) is still allowed', async () => {
    const { rest, calls } = fakeRest(() => ({ rows: [], total: 0 }));
    const ops = new BinanceFundingOps(rest, false, noSleep);
    expect((await ops.earnPositions('BNB')).length).toBe(0);
    expect(calls.length).toBe(1);
  });
});

describe('BinanceFundingOps error passthrough', () => {
  it('a definite rejection from bnbBurn set propagates typed', async () => {
    const { rest } = fakeRest(() => new BinanceError(400, -1022, 'Signature for this request is not valid.', 'POST /sapi/v1/bnbBurn'));
    const ops = new BinanceFundingOps(rest, true, noSleep);
    await expect(ops.setBnbBurn({ spotBNBBurn: true })).rejects.toBeInstanceOf(BinanceError);
  });
});
