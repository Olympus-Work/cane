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
  /** 'PENDING' | 'CONF' | 'FAILED' (Binance status codes). */
  status: string;
  timestamp: number;
}

export interface BnbBurnSettings {
  spotBNBBurn: boolean;
  interestBNBBurn: boolean;
}

/** One `/fapi/v1/income` row (B13, B26: funding and commission accounting). */
export interface IncomeRecord {
  symbol: string;
  incomeType: string;
  asset: string;
  amount: Decimal;
  time: number;
}

export type EarnPosition = {
  productId: string;
  asset: string;
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
/** `/fapi/v1/income` truncates windows longer than a month, so queries are chunked. */
const INCOME_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function num(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid Binance ${what}: ${JSON.stringify(value)}`);
  return value;
}

function str(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`Invalid Binance ${what}: ${JSON.stringify(value)}`);
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
  ) {}

  // --- Universal transfer (SPOT / UMFUTURE / FUNDING) ---

  /** POST /sapi/v1/asset/transfer. 'once' retry: an unclear outcome must be queried before resending. */
  async transfer(args: { type: UniversalTransferType; asset: string; amount: Decimal; clientTranId?: string }): Promise<{ tranId: number }> {
    if (!TRANSFER_TYPES.includes(args.type)) throw new Error(`transfer: unsupported type "${args.type}"`);
    if (!args.amount.gt(0)) throw new Error(`transfer: amount must be > 0, got ${args.amount.toFixed()}`);
    this.assertMoneyOps('transfer');
    const params: Params = { type: args.type, asset: args.asset, amount: args.amount.toFixed() };
    if (args.clientTranId !== undefined) params.clientTranId = args.clientTranId;
    const body = obj(await this.rest.request('spot', 'POST', '/sapi/v1/asset/transfer', params, 'signed', 'once'), 'transfer response');
    return { tranId: num(body.tranId, 'transfer tranId') };
  }

  /** GET /sapi/v1/asset/transfer: the record for `tranId`, or null while Binance has not indexed it. */
  async queryTransfer(args: { type: UniversalTransferType; tranId: number; from?: number; to?: number }): Promise<TransferRecord | null> {
    if (!TRANSFER_TYPES.includes(args.type)) throw new Error(`queryTransfer: unsupported type "${args.type}"`);
    const params: Params = { type: args.type, limit: INCOME_PAGE };
    if (args.from !== undefined) params.startTime = args.from;
    if (args.to !== undefined) params.endTime = args.to;
    const body = obj(await this.rest.request('spot', 'GET', '/sapi/v1/asset/transfer', params, 'signed', 'safe'), 'transfer history');
    const rows = await this.paged('/sapi/v1/asset/transfer', body, 'transfer history', (page: number) => ({ ...params, currentPage: page }));
    const hit = rows.find((r) => num(r.tranId, 'tranId') === args.tranId);
    return hit ? this.parseTransferRow(hit) : null;
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

  /** POST /fapi/v1/feeBurn (USDⓈ-M). */
  async setFeeBurn(enabled: boolean): Promise<boolean> {
    this.assertMoneyOps('setFeeBurn');
    const body = obj(await this.rest.request('futures', 'POST', '/fapi/v1/feeBurn', { feeBurn: String(enabled) }, 'signed', 'safe'), 'feeBurn set');
    return bool(body.feeBurn, 'feeBurn');
  }

  /**
   * B22 startup assert: both burns must be on. Enables what is off and reports
   * what changed so the caller can write the audit event.
   */
  async assertFeeBurnEnabled(): Promise<{ spotBNBBurn: boolean; feeBurn: boolean; changedSpot: boolean; changedPerp: boolean }> {
    const spot = await this.getBnbBurn();
    let changedSpot = false;
    if (!spot.spotBNBBurn) {
      await this.setBnbBurn({ spotBNBBurn: true });
      changedSpot = true;
    }
    const feeBurn = await this.getFeeBurn();
    let changedPerp = false;
    if (!feeBurn) {
      await this.setFeeBurn(true);
      changedPerp = true;
    }
    return { spotBNBBurn: true, feeBurn: true, changedSpot, changedPerp };
  }

  // --- Income history (B13, B26) ---

  /**
   * GET /fapi/v1/income per incomeType over `[from, to]`, month-chunked (Binance
   * truncates longer windows) and paged by the last row's time. Merged ascending
   * by time, then stable by the order of `incomeTypes`.
   */
  async income(args: { symbol?: string; incomeTypes: readonly string[]; from: number; to: number }): Promise<IncomeRecord[]> {
    if (args.incomeTypes.length === 0) throw new Error('income: no incomeType given');
    if (args.to <= args.from) throw new Error(`income: window end ${args.to} must be after start ${args.from}`);
    const out: IncomeRecord[] = [];
    for (const incomeType of args.incomeTypes) {
      for (let windowStart = args.from; windowStart <= args.to; windowStart += INCOME_WINDOW_MS) {
        const windowEnd = Math.min(windowStart + INCOME_WINDOW_MS - 1, args.to);
        let start = windowStart;
        for (;;) {
          const params: Params = { incomeType, startTime: start, endTime: windowEnd, limit: INCOME_PAGE };
          if (args.symbol !== undefined) params.symbol = args.symbol;
          const rows = (await this.rest.request('futures', 'GET', '/fapi/v1/income', params, 'signed', 'safe')) as unknown;
          if (!Array.isArray(rows)) throw new Error(`Invalid Binance income response: expected an array, got ${JSON.stringify(rows)}`);
          for (const raw of rows) out.push(this.parseIncomeRow(obj(raw, 'income row')));
          if (rows.length < INCOME_PAGE) break;
          const lastTime = num(obj(rows[rows.length - 1], 'income row').time, 'income time');
          start = lastTime + 1;
          if (start > windowEnd) break;
          await this.sleep(50);
        }
      }
    }
    out.sort((a, b) => a.time - b.time);
    return out;
  }

  private parseIncomeRow(raw: Record<string, unknown>): IncomeRecord {
    return {
      symbol: str(raw.symbol, 'income symbol'),
      incomeType: str(raw.incomeType, 'incomeType'),
      asset: str(raw.asset, 'income asset'),
      amount: dec(raw.amount, 'income amount'),
      time: num(raw.time, 'income time'),
    };
  }

  // --- Simple Earn Flexible (B24; not available on Binance Demo — mocked in tests) ---

  /** GET /sapi/v1/simple-earn/flexible/position for one asset. */
  async earnPositions(asset: string): Promise<EarnPosition[]> {
    const body = obj(await this.rest.request('spot', 'GET', '/sapi/v1/simple-earn/flexible/position', { asset }, 'signed', 'safe'), 'earn positions');
    const rows = await this.paged('/sapi/v1/simple-earn/flexible/position', body, 'earn positions', (page: number) => ({ asset, currentPage: page }));
    return rows.map((raw) => ({ productId: str(raw.productId, 'earn productId'), asset: str(raw.asset, 'earn asset'), amount: dec(raw.amount, 'earn amount') }));
  }

  /**
   * POST /sapi/v1/simple-earn/flexible/redeem. Omitting `amount` redeems the whole
   * position (Binance default). 'once': a lost response must be checked against the
   * position query before resending.
   */
  async earnRedeem(args: { productId: string; amount?: Decimal }): Promise<{ amount: Decimal | null }> {
    this.assertMoneyOps('earnRedeem');
    const params: Params = { productId: args.productId };
    if (args.amount !== undefined) params.amount = args.amount.toFixed();
    const body = obj(await this.rest.request('spot', 'POST', '/sapi/v1/simple-earn/flexible/redeem', params, 'signed', 'once'), 'earn redeem');
    if (body.success === false) throw new BinanceError(200, null, `Simple Earn redeem refused: ${JSON.stringify(body)}`, 'POST /sapi/v1/simple-earn/flexible/redeem');
    const amount = typeof body.amount === 'string' && body.amount !== '' ? new Decimal(body.amount) : null;
    return { amount };
  }

  /** Paged GETs that return `{ rows, total }`: pull further pages until `total` is covered. */
  private async paged(
    path: string,
    body: Record<string, unknown>,
    label: string,
    pageParams: (page: number) => Params,
  ): Promise<Record<string, unknown>[]> {
    const first = body.rows;
    if (!Array.isArray(first)) throw new Error(`Invalid Binance ${label}: expected rows, got ${JSON.stringify(first)}`);
    const total = num(body.total, `${label} total`);
    const out = first.map((r) => obj(r, `${label} row`));
    let page = 1;
    while (out.length < total) {
      page += 1;
      const more = obj(await this.rest.request('spot', 'GET', path, pageParams(page), 'signed', 'safe'), label);
      if (!Array.isArray(more.rows)) break;
      const rows = more.rows.map((r) => obj(r, `${label} row`));
      if (rows.length === 0) break;
      out.push(...rows);
    }
    return out;
  }

  private assertMoneyOps(operation: string): void {
    if (!this.moneyOpsEnabled) throw new MoneyOpsDisabledError(operation);
  }
}
