import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { CREDENTIALS, EngineService, JEV, NOTIFIER, type CredentialsSource } from './engine.service.js';
import { LogNotifier, UnavailableJev } from './ports.js';

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
    { provide: JEV, useClass: UnavailableJev },
  ],
})
export class EngineModule {}
