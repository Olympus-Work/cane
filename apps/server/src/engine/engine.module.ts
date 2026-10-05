import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { CREDENTIALS, EngineService, JEV, type CredentialsSource } from './engine.service.js';
import { SettingsJevClassifier } from '../jev/jev-settings.classifier.js';
import { SettingsService } from '../settings/settings.service.js';
import type { JevClassifier } from './ports.js';

/** `JEV_MAX_*` are env config, both off (0) by default (plan S07, owner 2026-09-30). */
const envInt = (name: string): number => {
  const n = Number(process.env[name] ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The trading engine. Keys come from Settings (S08). The Jev key and timeout
 * are read per call; the Binance key is read once when the engine starts
 * (EngineService.onModuleInit), so a new Binance key needs a restart (plan.md,
 * S08). The engine trades only when `TRADING_ENABLED=true`. Never imported by
 * the replay CLI (plan: replay isolation).
 */
@Module({
  imports: [DbModule, MarketDataModule],
  exports: [EngineService],
  providers: [
    EngineService,
    {
      provide: CREDENTIALS,
      inject: [SettingsService],
      useFactory: (settings: SettingsService): CredentialsSource => ({ get: () => settings.binanceCredentials() }),
    },
    {
      provide: JEV,
      inject: [SettingsService],
      useFactory: (settings: SettingsService): JevClassifier =>
        new SettingsJevClassifier(
          settings,
          (url, init) => fetch(url, init),
          Date.now,
          { maxRetries: envInt('JEV_MAX_RETRIES'), maxConcurrent: envInt('JEV_MAX_CONCURRENCY') },
          process.env.TYPESAFE_API_KEY || undefined,
        ),
    },
  ],
})
export class EngineModule {}
