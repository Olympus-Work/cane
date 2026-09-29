import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DB } from '../db/db.module.js';
import { ENDPOINTS, binanceEnvFrom } from '../binance/endpoints.js';
import { BinanceRestClient, type BinanceCredentials, type HttpFn } from '../binance/rest.client.js';
import { BinanceTrading } from '../binance/trading.js';
import { UserDataStream } from '../binance/user-data.stream.js';
import { KlineCache } from '../market-data/kline-cache.js';
import { Engine, KeyedMutex } from './engine.js';
import { Executor } from './executor.js';
import type { JevClassifier, Notifier } from './ports.js';
import { Reconciler } from './reconciler.js';
import { EngineStore } from './store.js';

/** Where the Binance key comes from: Settings, encrypted in the DB (B15, wired in S08). Null = none saved. */
export interface CredentialsSource {
  get(): Promise<BinanceCredentials | null>;
}

export const CREDENTIALS = Symbol('CREDENTIALS');
export const NOTIFIER = Symbol('NOTIFIER');
export const JEV = Symbol('JEV');

const TICK_MS = 60_000;
const RECONCILE_MS = 5 * 60_000; // B12.1

/**
 * Runs the engine inside the server: reconcile on start-up and every 5
 * minutes (B12), evaluate every minute (B1), and reconcile a strategy as soon
 * as its orders change on Binance. Does nothing unless `TRADING_ENABLED` is
 * `true` and a Binance key is saved (plan feature flag, rollback path).
 */
@Injectable()
export class EngineService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('EngineService');
  private timers: ReturnType<typeof setInterval>[] = [];
  private streams: UserDataStream[] = [];

  constructor(
    @Inject(DB) private readonly db: NodePgDatabase,
    private readonly klines: KlineCache,
    @Inject(CREDENTIALS) private readonly credentials: CredentialsSource,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
    @Inject(JEV) private readonly jev: JevClassifier,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.TRADING_ENABLED !== 'true') {
      this.log.warn('TRADING_ENABLED is not true: the engine is off');
      return;
    }
    const creds = await this.credentials.get();
    if (!creds) {
      this.log.warn('No Binance key saved: the engine is off');
      return;
    }
    const endpoints = ENDPOINTS[binanceEnvFrom(process.env.BINANCE_ENV)];
    const http: HttpFn = (url, init) => fetch(url, init);
    const rest = new BinanceRestClient(endpoints, () => creds, http);
    const trading = new BinanceTrading(rest, true);
    const store = new EngineStore(this.db);
    const mutex = new KeyedMutex();
    const now = Date.now;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const executor = new Executor({ store, trading, notifier: this.notifier, now, sleep });
    const engine = new Engine({ store, executor, candles: (m, p, tf, t) => this.klines.closedCandles(m, p, tf, t), jev: this.jev, mutex, now });
    const reconciler = new Reconciler({ store, executor, trading, notifier: this.notifier, mutex, now });

    await reconciler.reconcileAll();
    await this.notifier.notify('system_started', null, { env: binanceEnvFrom(process.env.BINANCE_ENV) });
    for (const market of ['spot', 'futures'] as const) {
      const stream = new UserDataStream(market, endpoints, rest, () => creds, {
        onEvent: (e) => {
          const strategyId = /^(S-[0-9]{2,})-/.exec(e.clientId)?.[1];
          if (strategyId) void reconciler.reconcileOne(strategyId);
        },
        onConnected: () => void reconciler.reconcileAll(), // events may have been missed
        onError: (err) => this.log.warn(`${market} user data: ${err.message}`),
      });
      await stream.start();
      this.streams.push(stream);
    }
    this.timers.push(setInterval(() => void engine.tick(), TICK_MS));
    this.timers.push(setInterval(() => void reconciler.reconcileAll(), RECONCILE_MS));
    this.log.log('engine started');
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearInterval(t);
    for (const s of this.streams) s.stop();
  }
}
