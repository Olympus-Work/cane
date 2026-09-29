import { createHmac } from 'node:crypto';
import type { BinanceEndpoints, BinanceMarket } from './endpoints.js';

/** API key + secret. Supplied by Settings (S08) or, in integration tests, by `.env`. Never logged. */
export interface BinanceCredentials {
  apiKey: string;
  apiSecret: string;
}

export type HttpFn = (
  url: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

export type SleepFn = (ms: number) => Promise<void>;

/**
 * `none`: public; `key`: API-key header only (listenKey); `signed`: key + HMAC
 * signature with a Binance-synced timestamp (E11).
 */
export type Auth = 'none' | 'key' | 'signed';

/**
 * `safe`: the request changes nothing (queries, cancels, listenKey), so
 * network errors, 429/418 and 5xx are retried with back-off.
 * `once`: order placement — an unclear outcome is surfaced as
 * {@link UnknownOutcomeError} for the caller to query before resending (E1).
 */
export type RetryMode = 'safe' | 'once';

export type Params = Record<string, string | number | boolean | undefined>;

/** A definite rejection from Binance (HTTP 4xx with a Binance error code). */
export class BinanceError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
    readonly binanceMsg: string,
    readonly endpoint: string,
  ) {
    super(`Binance ${endpoint} failed: HTTP ${status} code ${code ?? '-'} ${binanceMsg}`);
    this.name = 'BinanceError';
  }
}

/** The request may or may not have reached the matching engine (network error, timeout, 5xx). */
export class UnknownOutcomeError extends Error {
  constructor(
    readonly endpoint: string,
    readonly reason: string,
  ) {
    super(`Binance ${endpoint}: outcome unknown (${reason})`);
    this.name = 'UnknownOutcomeError';
  }
}

/** Binance `-1021`: timestamp outside recvWindow (clock drift). */
const TIMESTAMP_OUTSIDE_RECV_WINDOW = -1021;
/** Binance `-1007`: backend timeout, execution status unknown. */
const BACKEND_TIMEOUT = -1007;

const MAX_SAFE_ATTEMPTS = 5;
const RECV_WINDOW_MS = 5000;
const TIME_PATH: Record<BinanceMarket, string> = { spot: '/api/v3/time', futures: '/fapi/v1/time' };

/**
 * Minimal Binance REST client for spot and USDⓈ-M. Signs with HMAC-SHA256 over
 * the query string and keeps a per-market offset to Binance server time (E11).
 * Errors never include the query string, key or signature.
 */
export class BinanceRestClient {
  private readonly offsetMs: Record<BinanceMarket, number | null> = { spot: null, futures: null };

  constructor(
    private readonly endpoints: BinanceEndpoints,
    private readonly credentials: () => BinanceCredentials,
    private readonly http: HttpFn,
    private readonly sleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = Date.now,
  ) {}

  /** Measures the offset to Binance server time (E11); called lazily before the first signed request. */
  async syncTime(market: BinanceMarket): Promise<number> {
    const before = this.now();
    const body = (await this.request(market, 'GET', TIME_PATH[market], {}, 'none', 'safe')) as { serverTime: number };
    const after = this.now();
    const offset = body.serverTime - Math.round((before + after) / 2);
    this.offsetMs[market] = offset;
    return offset;
  }

  /** Binance-synced "now" for signing outside REST (spot WebSocket API subscribe). */
  async serverNow(market: BinanceMarket): Promise<number> {
    const offset = this.offsetMs[market] ?? (await this.syncTime(market));
    return this.now() + offset;
  }

  async request(
    market: BinanceMarket,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    params: Params,
    auth: Auth,
    retry: RetryMode,
  ): Promise<unknown> {
    const endpoint = `${method} ${path}`;
    let resynced = false;
    for (let attempt = 1; ; attempt++) {
      const url = await this.buildUrl(market, path, params, auth);
      const headers: Record<string, string> = auth === 'none' ? {} : { 'X-MBX-APIKEY': this.credentials().apiKey };

      let res: Awaited<ReturnType<HttpFn>>;
      try {
        res = await this.http(url, { method, headers });
      } catch (err) {
        const reason = err instanceof Error ? err.name : 'network error';
        if (retry === 'once') throw new UnknownOutcomeError(endpoint, reason);
        if (attempt >= MAX_SAFE_ATTEMPTS) throw new UnknownOutcomeError(endpoint, `${reason} after ${attempt} attempts`);
        await this.sleep(backoffMs(attempt, null));
        continue;
      }

      const text = await res.text();
      const body = parseJson(text);
      if (res.status >= 200 && res.status < 300) return body;

      const code = errorCode(body);
      const msg = errorMsg(body);
      if (code === TIMESTAMP_OUTSIDE_RECV_WINDOW && auth === 'signed' && !resynced) {
        // Rejected before execution, so a resend is safe even for orders.
        resynced = true;
        await this.syncTime(market);
        continue;
      }
      const transient = res.status === 429 || res.status === 418 || res.status >= 500 || code === BACKEND_TIMEOUT;
      if (!transient) throw new BinanceError(res.status, code, msg, endpoint);
      if (retry === 'once') {
        // 429/418 are rejected before execution; 5xx and -1007 may have executed.
        if (res.status === 429 || res.status === 418) throw new BinanceError(res.status, code, msg, endpoint);
        throw new UnknownOutcomeError(endpoint, `HTTP ${res.status} code ${code ?? '-'}`);
      }
      if (attempt >= MAX_SAFE_ATTEMPTS) throw new BinanceError(res.status, code, msg, endpoint);
      await this.sleep(backoffMs(attempt, res.headers.get('Retry-After')));
    }
  }

  private async buildUrl(market: BinanceMarket, path: string, params: Params, auth: Auth): Promise<string> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
    if (auth === 'signed') {
      const offset = this.offsetMs[market] ?? (await this.syncTime(market));
      q.set('timestamp', String(this.now() + offset));
      q.set('recvWindow', String(RECV_WINDOW_MS));
      q.set('signature', hmacHex(this.credentials().apiSecret, q.toString()));
    }
    const qs = q.toString();
    return `${this.endpoints.rest[market]}${path}${qs ? `?${qs}` : ''}`;
  }
}

export function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function backoffMs(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter !== null && retryAfter !== '' ? Number(retryAfter) : NaN;
  return Number.isFinite(seconds) ? seconds * 1000 : 500 * 2 ** (attempt - 1);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function errorCode(body: unknown): number | null {
  const code = (body as { code?: unknown } | null)?.code;
  return typeof code === 'number' ? code : null;
}

function errorMsg(body: unknown): string {
  const msg = (body as { msg?: unknown } | null)?.msg;
  return typeof msg === 'string' ? msg : '';
}
