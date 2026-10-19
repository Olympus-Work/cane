import { Inject, Module, type DynamicModule, type OnModuleDestroy } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { FundingEvent } from '@cane/core';
import { FundingStore } from '../funding/funding.store.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { BACKTEST_FUNDING, FundingBacktestService, type FundingReader } from './funding-backtest.service.js';

const READONLY_POOL = Symbol('READONLY_POOL');

/** Exposes only the F01 store's range read; the `cane_replay` user cannot write anyway. */
class FundingRangeReader implements FundingReader {
  constructor(private readonly store: FundingStore) {}

  range(symbol: string, from: number, to: number): Promise<FundingEvent[]> {
    return this.store.range(symbol, from, to);
  }
}

/**
 * Funding-arb backtest context (plan F02): public market data, core rules and
 * a read-only pool of its own for `funding_rate`. Must never import DbModule
 * (the server's write-capable pool), a Binance trading module, an order
 * executor or any key/secret provider — enforced by
 * test/funding-backtest-isolation.test.ts. The CLI entry passes the URL in.
 */
@Module({})
export class FundingBacktestModule implements OnModuleDestroy {
  constructor(@Inject(READONLY_POOL) private readonly pool: pg.Pool) {}

  static forUrl(connectionString: string): DynamicModule {
    return {
      module: FundingBacktestModule,
      imports: [MarketDataModule],
      providers: [
        { provide: READONLY_POOL, useFactory: () => new pg.Pool({ connectionString, max: 2 }) },
        { provide: BACKTEST_FUNDING, inject: [READONLY_POOL], useFactory: (pool: pg.Pool) => new FundingRangeReader(new FundingStore(drizzle(pool))) },
        FundingBacktestService,
      ],
      exports: [FundingBacktestService],
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
