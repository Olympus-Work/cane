import { Decimal } from 'decimal.js';
import { BinanceError, type BinanceRestClient, type Params, type SleepFn } from './rest.client.js';

/**
 * Funding-arb adapter extensions on top of the S05 REST client (ticket F03):
 * universal transfer, BNB fee-burn toggles, futures income history and Simple
 * Earn Flexible (BNB refill). Binance does not scope these calls to a sub-account
 * by parameter — the API key belongs to the sub-account (spec Security: dedicated
 * `cane-arb` sub-account, trade + internal transfer only, withdrawals disabled),
 * so every call here already acts on that wallet when built from its credentials.
 *
 * Request/response shapes follow developers.binance.com (PR #43 review, items 1–5):
 * - `/fapi/v1/income` rows carry `income` (not `amount`); pages with `page`/`limit`;
 *   `tranId` is unique per incomeType; history exists only for the last 3 months.
 * - `POST /fapi/v1/feeBurn` answers `{code,msg}` without the new state — confirm with GET.
 * - Simple Earn flexible position amount is `totalAmount`; SAPI list endpoints page
 *   with `current`/`size` (max 100), not `currentPage`/`limit`.
 * - Flexible redeem requires `amount` unless `redeemAll` is sent; the answer is
 *   `{redeemId, success}` (no amount).
 * - `POST /sapi/v1/asset/transfer` has no client-id parameter; history rows do not
 *   carry one either. An unclear outcome is resolved with {@link findTransfers}
 *   (type + asset + amount + time window); a transfer whose outcome is unknown is
 *   NEVER auto-resent.
 *
 * Behaviour references: B17 (rebalance transfer), B22 (fee-burn assert on startup),
 * B23–B25 (BNB buffer top-up via Simple Earn redeem), B13/B26 (income accounting).
 */

/** Wallet pairs the arb flow moves between (Binance universal-transfer types). */
export type UniversalTransferType =
  | 'MAIN_UMFUTURE'
  | 'UMFUTURE_MAIN'
  | 'MAIN_FUNDING'
  | 'FUNDING_MAIN'
  | 'FUNDING_UMFUTURE'
  | 'UMFUTURE_FUNDING';

const TRANSFER_TYPES: readonly string[] = [
  'MAIN_UMFUTURE',
  'UMFUTURE_MAIN',
  'MAIN_FUNDING',
  'FUNDING_MAIN',
  'FUNDING_UMFUTURE',
  'UMFUTURE_FUNDING',
];

/** A universal transfer as Binance reports it in history. */
export interface TransferRecord {
  tranId: number;
  type: string;
  asset: string;
  amount: Decimal;
  /** 'PENDING' | 'CONFIRMED' | 'FAILED' (docs). */
  status: string;
  timestamp: number;
}

export interface BnbBurnSettings {
  spotBNBBurn: boolean;
  interestBNBBurn: boolean;
}

/** One `/fapi/v1/income` row (B13, B26: funding and commission accounting). */
export interface IncomeRecord {
  /** Empty for income rows that carry no trade symbol (docs example: TRANSFER rows). */
  symbol: string;
  incomeType: string;
  asset: string;
  /** The documented field is `income`. */
  amount: Decimal;
  info: string;
  /** Unique per incomeType for this user (docs) — the dedup key. */
  tranId: number;
  /** Set when the income came from a trade; empty otherwise. */
  tradeId: string;
  time: number;
}

export type EarnPosition = {
  productId: string;
  asset: string;
  /** The documented position field is `totalAmount`. */
  amount: Decimal;
};

/** Same guard as {@link BinanceTrading}: a disabled context must never move money. */
export class MoneyOpsDisabledError extends Error {
  constructor(readonly operation: string) {
    super(`Binance funding ops: ${operation} refused, money-moving ops are disabled in this context`);
    this.name = 'MoneyOpsDisabledError';
  }
}

const INCOME_PAGE = 1000;
/** Docs: income history only contains data for the last three months. */
const INCOME_LOOKBACK_MS = 92 * 24 * 60 * 60 * 1000;
/** Explicit month chunks keep each income query bounded (7-day default, 3-month lookback). */
const INCOME_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** SAPI list paging (transfer history, earn positions): default 10, max 100 (docs). */
const SAPI_PAGE_SIZE = 100;

function num(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid Binance ${what}: ${JSON.stringify(value)}`);
  return value;
}

function str(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`Invalid Binance ${what}: ${JSON.stringify(value)}`);
  return value;
}

function strAllowEmpty(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid Binance ${what}: ${JSON.stringify(value)}`);
  return value;
}

function bool(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid Binance ${what}: ${JSON.stringify(value)}`);
  return value;
}

function dec(value: unknown, what: string): Decimal {
  if (typeof value !== 'string' || value === '') throw new Error(`Invalid Binance ${what}: ${JSON.stringify(value)}`);
  return new Decimal(value);
}

function obj(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Invalid Binance ${what}: ${JSON.stringify(value)}`);
  return value as Record<string, unknown>;
}

export class BinanceFundingOps {
  constructor(
    private readonly rest: BinanceRestClient,
    private readonly moneyOpsEnabled: boolean,
    private readonly sleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = Date.now,
  ) {}

  // --- Universal transfer (SPOT / UMFUTURE / FUNDING) ---

  /**
   * POST /sapi/v1/asset/transfer. 'once' retry: a lost response surfaces as
   * {@link UnknownOutcomeError}. The endpoint has no client-transfer-id parameter,
   * so resolve the outcome with {@link findTransfers} using the send time — and
   * never resend while it is unknown (double transfer risk, PR #43 review item 6).
   */
  async transfer(args: { type: UniversalTransferType; asset: string; amount: Decimal }): Promise<{ tranId: number }> {
    if (!TRANSFER_TYPES.includes(args.type)) throw new Error(`transfer: unsupported type "${args.type}"`);
    if (!args.amount.gt(0)) throw new Error(`transfer: amount must be > 0, got ${args.amount.toFixed()}`);
    this.assertMoneyOps('transfer');
    const params: Params = { type: args.type, asset: args.asset, amount: args.amount.toFixed() };
    const body = obj(await this.rest.request('spot', 'POST', '/sapi/v1/asset/transfer', params, 'signed', 'once'), 'transfer response');
    return { tranId: num(body.tranId, 'transfer tranId') };
  }

  /**
   * GET /sapi/v1/asset/transfer: the record for `tranId`, or null while Binance
   * has not indexed it. `from` is required because the endpoint defaults to the
   * last 7 days (docs) — a caller resolving an older lost transfer must widen the
   * window itself, never silently read "not in the 7-day default" as "not found".
   */
  async queryTransfer(args: { type: UniversalTransferType; tranId: number; from: number; to?: number }): Promise<TransferRecord | null> {
    if (!Number.isFinite(args.from)) throw new Error(`queryTransfer: from is required — the endpoint defaults to the last 7 days (docs), so an implicit window must never read as "not found" for a lost transfer`);
    const rows = await this.transferHistory(args);
    return rows.find((r) => r.tranId === args.tranId) ?? null;
  }

  /**
   * The unclear-outcome tool: history rows matching type + asset + amount since
   * `sinceMs`. Exactly one match resolves a lost response; more than one is
   * ambiguous and the caller must keep treating the outcome as unknown.
   */
  async findTransfers(args: {
    type: UniversalTransferType;
    asset: string;
    amount: Decimal;
    sinceMs: number;
    untilMs?: number;
  }): Promise<TransferRecord[]> {
    const rows = await this.transferHistory({ type: args.type, from: args.sinceMs, to: args.untilMs });
    return rows.filter((r) => r.asset === args.asset && r.amount.equals(args.amount));
  }

  private async transferHistory(args: { type: UniversalTransferType; from?: number; to?: number }): Promise<TransferRecord[]> {
    if (!TRANSFER_TYPES.includes(args.type)) throw new Error(`transfer history: unsupported type "${args.type}"`);
    const params: Params = { type: args.type };
    if (args.from !== undefined) params.startTime = args.from;
    if (args.to !== undefined) params.endTime = args.to;
    const rows = await this.listPages('/sapi/v1/asset/transfer', params, 'transfer history');
    return rows.map((raw) => this.parseTransferRow(raw));
  }

  private parseTransferRow(raw: Record<string, unknown>): TransferRecord {
    return {
      tranId: num(raw.tranId, 'tranId'),
      type: str(raw.type, 'transfer type'),
      asset: str(raw.asset, 'transfer asset'),
      amount: dec(raw.amount, 'transfer amount'),
      status: str(raw.status, 'transfer status'),
      timestamp: num(raw.timestamp, 'transfer timestamp'),
    };
  }

  // --- BNB fee burn (B22) ---

  /** GET /sapi/v1/bnbBurn (spot). */
  async getBnbBurn(): Promise<BnbBurnSettings> {
    const body = obj(await this.rest.request('spot', 'GET', '/sapi/v1/bnbBurn', {}, 'signed', 'safe'), 'bnbBurn');
    return { spotBNBBurn: bool(body.spotBNBBurn, 'spotBNBBurn'), interestBNBBurn: bool(body.interestBNBBurn, 'interestBNBBurn') };
  }

  /** POST /sapi/v1/bnbBurn (spot): set `spotBNBBurn`, leave interest as-is unless given. */
  async setBnbBurn(args: { spotBNBBurn: boolean; interestBNBBurn?: boolean }): Promise<BnbBurnSettings> {
    this.assertMoneyOps('setBnbBurn');
    const params: Params = { spotBNBBurn: String(args.spotBNBBurn) };
    if (args.interestBNBBurn !== undefined) params.interestBNBBurn = String(args.interestBNBBurn);
    const body = obj(await this.rest.request('spot', 'POST', '/sapi/v1/bnbBurn', params, 'signed', 'safe'), 'bnbBurn set');
    return { spotBNBBurn: bool(body.spotBNBBurn, 'spotBNBBurn'), interestBNBBurn: bool(body.interestBNBBurn, 'interestBNBBurn') };
  }

  /** GET /fapi/v1/feeBurn (USDⓈ-M). */
  async getFeeBurn(): Promise<boolean> {
    const body = obj(await this.rest.request('futures', 'GET', '/fapi/v1/feeBurn', {}, 'signed', 'safe'), 'feeBurn');
    return bool(body.feeBurn, 'feeBurn');
  }

  /**
   * POST /fapi/v1/feeBurn (USDⓈ-M). The documented answer is `{code, msg}` and
   * carries no state, so the result is confirmed with GET and that value returned.
   */
  async setFeeBurn(enabled: boolean): Promise<boolean> {
    this.assertMoneyOps('setFeeBurn');
    obj(await this.rest.request('futures', 'POST', '/fapi/v1/feeBurn', { feeBurn: String(enabled) }, 'signed', 'safe'), 'feeBurn set');
    return this.getFeeBurn();
  }

  /**
   * B22 startup assert: both burns must be on. Enables what is off, uses the
   * **confirmed** value of each toggle (the perp POST is confirmed by GET, and the
   * spot POST echoes the state), and throws when a burn is still off after enabling
   * — so a caller never logs a B22 success the exchange does not have.
   */
  async assertFeeBurnEnabled(): Promise<{ spotBNBBurn: boolean; feeBurn: boolean; changedSpot: boolean; changedPerp: boolean }> {
    const spot = await this.getBnbBurn();
    let spotBNBBurn = spot.spotBNBBurn;
    let changedSpot = false;
    if (!spotBNBBurn) {
      spotBNBBurn = (await this.setBnbBurn({ spotBNBBurn: true })).spotBNBBurn;
      if (!spotBNBBurn) throw new Error('assertFeeBurnEnabled: spotBNBBurn still off after enabling');
      changedSpot = true;
    }
    let feeBurn = await this.getFeeBurn();
    let changedPerp = false;
    if (!feeBurn) {
      feeBurn = await this.setFeeBurn(true);
      if (!feeBurn) throw new Error('assertFeeBurnEnabled: feeBurn still off after enabling');
      changedPerp = true;
    }
    return { spotBNBBurn, feeBurn, changedSpot, changedPerp };
  }

  // --- Income history (B13, B26) ---

  /**
   * GET /fapi/v1/income per incomeType over `[from, to]`. Month-chunked so each
   * query is bounded and paged **by time, not by `page`**: the live docs table
   * disagreement in review (and the fact that a `page`-ignoring server would
   * otherwise truncate silently) means the adapter refuses to depend on it.
   * A full page moves `startTime` to the last row's `time` (inclusive) and the
   * `${incomeType}:${tranId}` dedupe absorbs the boundary row — `tranId` is only
   * unique within one incomeType (docs). If a full page adds NO new rows the
   * cursor cannot advance (>1000 rows sharing one timestamp): throw rather than
   * return a history that looks complete. Binance keeps only the last three
   * months, so a `from` older than that throws instead of a silent partial
   * history. Sorted ascending by time, then tranId.
   */
  async income(args: { symbol?: string; incomeTypes: readonly string[]; from: number; to: number }): Promise<IncomeRecord[]> {
    if (args.incomeTypes.length === 0) throw new Error('income: no incomeType given');
    if (args.to <= args.from) throw new Error(`income: window end ${args.to} must be after start ${args.from}`);
    if (args.from < this.now() - INCOME_LOOKBACK_MS) {
      throw new Error(`income: from ${new Date(args.from).toISOString()} is older than the 3-month history Binance keeps`);
    }
    const out: IncomeRecord[] = [];
    const seen = new Set<string>();
    for (const incomeType of args.incomeTypes) {
      for (let windowStart = args.from; windowStart <= args.to; windowStart += INCOME_WINDOW_MS) {
        const windowEnd = Math.min(windowStart + INCOME_WINDOW_MS - 1, args.to);
        let cursor = windowStart;
        for (;;) {
          const params: Params = { incomeType, startTime: cursor, endTime: windowEnd, limit: INCOME_PAGE };
          if (args.symbol !== undefined) params.symbol = args.symbol;
          const rows = await this.rest.request('futures', 'GET', '/fapi/v1/income', params, 'signed', 'safe');
          if (!Array.isArray(rows)) throw new Error(`Invalid Binance income response: expected an array, got ${JSON.stringify(rows)}`);
          let added = 0;
          let lastTime = cursor;
          for (const raw of rows) {
            const record = this.parseIncomeRow(obj(raw, 'income row'));
            lastTime = Math.max(lastTime, record.time);
            const key = `${record.incomeType}:${record.tranId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(record);
            added++;
          }
          if (rows.length < INCOME_PAGE) break; // last page of this window
          if (added === 0) {
            throw new Error(`income: paging stalled at ${new Date(lastTime).toISOString()} for ${incomeType} — a full page added no new rows (>1000 rows share one timestamp); refusing to return a truncated history`);
          }
          cursor = lastTime; // inclusive; the dedupe absorbs the boundary row
          await this.sleep(50);
        }
      }
    }
    out.sort((a, b) => a.time - b.time || a.tranId - b.tranId);
    return out;
  }

  private parseIncomeRow(raw: Record<string, unknown>): IncomeRecord {
    return {
      symbol: strAllowEmpty(raw.symbol, 'income symbol'),
      incomeType: str(raw.incomeType, 'incomeType'),
      asset: str(raw.asset, 'income asset'),
      amount: dec(raw.income, 'income'),
      info: strAllowEmpty(raw.info, 'income info'),
      tranId: num(raw.tranId, 'income tranId'),
      tradeId: strAllowEmpty(raw.tradeId, 'income tradeId'),
      time: num(raw.time, 'income time'),
    };
  }

  // --- Simple Earn Flexible (B24; not available on Binance Demo — mocked in tests) ---

  /** GET /sapi/v1/simple-earn/flexible/position for one asset (amount field: `totalAmount`). */
  async earnPositions(asset: string): Promise<EarnPosition[]> {
    const rows = await this.listPages('/sapi/v1/simple-earn/flexible/position', { asset }, 'earn positions');
    return rows.map((raw) => ({
      productId: str(raw.productId, 'earn productId'),
      asset: str(raw.asset, 'earn asset'),
      amount: dec(raw.totalAmount, 'earn totalAmount'),
    }));
  }

  /**
   * POST /sapi/v1/simple-earn/flexible/redeem. Docs: `amount` is mandatory unless
   * `redeemAll` is sent — pass `{ redeemAll: true }` for the whole position, or an
   * explicit amount. 'once': a lost response is checked against {@link earnPositions}
   * before resending. The answer is `{redeemId, success}` (no amount), so the
   * caller records `redeemId` to look the redemption up later.
   */
  async earnRedeem(args: { productId: string; amount?: Decimal; redeemAll?: boolean }): Promise<{ redeemId: number }> {
    this.assertMoneyOps('earnRedeem');
    const params: Params = { productId: args.productId };
    if (args.redeemAll === true) {
      params.redeemAll = 'true';
    } else {
      if (args.amount === undefined || !args.amount.gt(0)) {
        throw new Error(`earnRedeem: amount is mandatory unless redeemAll is true (docs), productId ${args.productId}`);
      }
      params.amount = args.amount.toFixed();
    }
    const body = obj(await this.rest.request('spot', 'POST', '/sapi/v1/simple-earn/flexible/redeem', params, 'signed', 'once'), 'earn redeem');
    if (body.success === false) throw new BinanceError(200, null, `Simple Earn redeem refused: ${JSON.stringify(body)}`, 'POST /sapi/v1/simple-earn/flexible/redeem');
    return { redeemId: num(body.redeemId, 'earn redeem redeemId') };
  }

  /**
   * SAPI list endpoints (`{ rows, total }`): page with the documented `current`/
   * `size` (max 100) and stop on `total`, an empty page, or a page that adds
   * nothing new — a server ignoring the paging params must not spin (review item 5).
   */
  private async listPages(path: string, baseParams: Params, label: string): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (let current = 1; ; current++) {
      const body = obj(
        await this.rest.request('spot', 'GET', path, { ...baseParams, current, size: SAPI_PAGE_SIZE }, 'signed', 'safe'),
        label,
      );
      if (!Array.isArray(body.rows)) throw new Error(`Invalid Binance ${label}: expected rows, got ${JSON.stringify(body.rows)}`);
      let added = 0;
      for (const raw of body.rows) {
        const row = obj(raw, `${label} row`);
        const key = JSON.stringify([row.tranId ?? null, row.productId ?? null, row.timestamp ?? null, row.amount ?? null]);
        if (!seen.has(key)) {
          seen.add(key);
          rows.push(row);
          added++;
        }
      }
      if (added === 0 || rows.length >= num(body.total, `${label} total`)) return rows;
    }
  }

  private assertMoneyOps(operation: string): void {
    if (!this.moneyOpsEnabled) throw new MoneyOpsDisabledError(operation);
  }
}
