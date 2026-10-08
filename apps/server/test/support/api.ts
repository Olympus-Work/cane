import 'reflect-metadata';
import { generateSync } from 'otplib';
import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { vi } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp, newAdapter } from '../../src/app.setup.js';
import { AuthService } from '../../src/auth/auth.service.js';
import { NOTIFIER } from '../../src/engine/engine.service.js';
import { EXCHANGE_READER, ExchangeReadError, type ExchangeReader, type ExchangeSnapshot } from '../../src/exchange/exchange-reader.js';
import { freshDb } from './db.js';

export const EMAIL = 'owner@example.com';
export const PASSWORD = 'fixture-password-9f3k2m1z';
const MASTER_KEY = Buffer.alloc(32, 7).toString('base64');

/** A fake exchange: tests set `snapshot`, `failWith` and `listed`; nothing touches the network. */
export class FakeExchange implements ExchangeReader {
  snapshotValue: ExchangeSnapshot = { spotEquity: '1000', futuresEquity: '2000', tickers: {}, futuresPositions: [] };
  failWith: ExchangeReadError | null = null;
  /** Whether the latest snapshot() asked for a fresh read. */
  lastFresh = false;
  listed = new Set<string>(['futures:BTCUSDT', 'futures:ETHUSDT', 'spot:BTCUSDT', 'spot:ETHUSDT']);
  async snapshot(opts?: { fresh?: boolean }): Promise<ExchangeSnapshot> {
    this.lastFresh = opts?.fresh === true;
    if (this.failWith) throw this.failWith;
    return this.snapshotValue;
  }
  async isListed(market: 'spot' | 'futures', pair: string): Promise<boolean> {
    if (this.failWith) throw this.failWith;
    return this.listed.has(`${market}:${pair}`);
  }
}

export interface Api {
  app: NestFastifyApplication;
  pool: pg.Pool;
  exchange: FakeExchange;
  /** A session cookie token for the seeded owner. */
  token: string;
  /** A TOTP code for a step nobody has used yet (moves the fake clock forward 31 s first). */
  freshCode(): string;
  call(method: 'GET' | 'POST' | 'PATCH', url: string, opts?: { body?: unknown; token?: string | null; code?: string }): ReturnType<NestFastifyApplication['inject']>;
  close(): Promise<void>;
}

/**
 * Boots the whole app on a fresh Postgres with a fake exchange, seeds the
 * owner and signs in. Only `Date` is faked (the fake clock starts at
 * `startMs`), so timers and I/O behave normally.
 */
export async function bootApi(startMs: number): Promise<Api> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(startMs);
  process.env.CANE_MASTER_KEY = MASTER_KEY;
  delete process.env.TRADING_ENABLED;
  delete process.env.TYPESAFE_API_KEY;
  const pool = await freshDb();
  const exchange = new FakeExchange();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EXCHANGE_READER)
    .useValue(exchange)
    .overrideProvider(NOTIFIER)
    .useValue({ notify: async () => undefined })
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(newAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const auth = app.get(AuthService);
  const seeded = await auth.seedOwner(EMAIL, PASSWORD);
  if (typeof seeded === 'string') throw new Error(`seed failed: ${seeded}`);
  const secret = seeded.enrolment.secret;

  const freshCode = (): string => {
    vi.setSystemTime(Date.now() + 31_000);
    return generateSync({ strategy: 'totp', secret, epoch: Math.floor(Date.now() / 1000) });
  };
  const call: Api['call'] = (method, url, opts = {}) => {
    const headers: Record<string, string> = {};
    const token = opts.token === undefined ? api.token : opts.token;
    if (token) headers.cookie = `cane_session=${token}`;
    if (opts.code) headers['x-totp-code'] = opts.code;
    return app.inject({ method, url, headers, ...(opts.body === undefined ? {} : { payload: opts.body as object }) });
  };
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: EMAIL, password: PASSWORD, code: freshCode() } });
  const token = login.cookies.find((c) => c.name === 'cane_session')?.value;
  if (!token) throw new Error('login failed');
  const api: Api = {
    app,
    pool,
    exchange,
    token,
    freshCode,
    call,
    close: async () => {
      await app.close();
      await pool.end();
      vi.useRealTimers();
    },
  };
  return api;
}
