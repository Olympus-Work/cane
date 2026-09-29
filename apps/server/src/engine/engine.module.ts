import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { CREDENTIALS, EngineService, JEV, NOTIFIER, type CredentialsSource } from './engine.service.js';
import { JevClient } from '../jev/jev.client.js';
import { LogNotifier, UnavailableJev, type JevClassifier } from './ports.js';

/**
 * The trading engine. Not imported by AppModule yet: it needs the Binance
 * key from Settings (S08); until then CREDENTIALS returns none. Never
 * imported by the replay CLI (plan: replay isolation).
 */
@Module({
  imports: [DbModule, MarketDataModule],
  providers: [
    EngineService,
    { provide: CREDENTIALS, useValue: { get: async () => null } satisfies CredentialsSource },
    { provide: NOTIFIER, useClass: LogNotifier },
    {
      provide: JEV,
      // No key means B8.4 fallback (base size), not a crash. S08 moves the timeout into Settings.
      useFactory: (): JevClassifier => {
        const apiKey = process.env.TYPESAFE_API_KEY;
        if (!apiKey) return new UnavailableJev();
        // Owner 2026-09-30: retry and concurrency cap are env config, both off by default.
        const maxRetries = Number(process.env.JEV_MAX_RETRIES ?? 0);
        const maxConcurrent = Number(process.env.JEV_MAX_CONCURRENCY ?? 0);
        return new JevClient({
          apiKey,
          fetch: (url, init) => fetch(url, init),
          now: Date.now,
          maxRetries: Number.isFinite(maxRetries) ? maxRetries : 0,
          maxConcurrent: Number.isFinite(maxConcurrent) ? maxConcurrent : 0,
        });
      },
    },
  ],
})
export class EngineModule {}
