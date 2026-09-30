import { Module } from '@nestjs/common';
import { binanceEnvFrom } from '../binance/endpoints.js';
import { SettingsService } from '../settings/settings.service.js';
import { BinanceExchangeReader } from './binance-exchange-reader.js';
import { EXCHANGE_READER, type ExchangeReader } from './exchange-reader.js';
import { ExchangeStateService } from './exchange-state.service.js';

/** Read-only Binance access for the API. The key comes from Settings on every refresh, so a new key applies at once. */
@Module({
  providers: [
    {
      provide: EXCHANGE_READER,
      inject: [SettingsService],
      useFactory: (settings: SettingsService): ExchangeReader =>
        new BinanceExchangeReader(() => settings.binanceCredentials(), (url, init) => fetch(url, init), binanceEnvFrom(process.env.BINANCE_ENV)),
    },
    ExchangeStateService,
  ],
  exports: [EXCHANGE_READER, ExchangeStateService],
})
export class ExchangeModule {}
