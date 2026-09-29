import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { CREDENTIALS, EngineService, JEV, NOTIFIER, type CredentialsSource } from './engine.service.js';
import { SettingsJevClassifier } from '../jev/jev-settings.classifier.js';
import { SettingsService } from '../settings/settings.service.js';
import { LogNotifier, type JevClassifier } from './ports.js';

/** `JEV_MAX_*` are env config, both off (0) by default (plan S07, owner 2026-09-30). */
const envInt = (name: string): number => {
  const n = Number(process.env[name] ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The trading engine. Keys come from Settings (S08), read per call, so a key
 * change needs no restart. The engine trades only when `TRADING_ENABLED=true`
 * (EngineService). Never imported by the replay CLI (plan: replay isolation).
 */
@Module({
  imports: [DbModule, MarketDataModule],
  providers: [
    EngineService,
    {
      provide: CREDENTIALS,
      inject: [SettingsService],
      useFactory: (settings: SettingsService): CredentialsSource => ({ get: () => settings.binanceCredentials() }),
    },
    { provide: NOTIFIER, useClass: LogNotifier },
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
