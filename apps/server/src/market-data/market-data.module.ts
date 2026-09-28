import { Module } from '@nestjs/common';
import { KlinesClient, FETCH_FN, type FetchFn } from './klines.client.js';
import { KlineCache, KLINE_CACHE_DIR, DEFAULT_KLINE_CACHE_DIR } from './kline-cache.js';

@Module({
  providers: [
    KlinesClient,
    KlineCache,
    { provide: FETCH_FN, useValue: ((url: string, init?: { method?: string }): Promise<unknown> => fetch(url, init)) as FetchFn },
    { provide: KLINE_CACHE_DIR, useValue: DEFAULT_KLINE_CACHE_DIR },
  ],
  exports: [KlinesClient, KlineCache],
})
export class MarketDataModule {}
