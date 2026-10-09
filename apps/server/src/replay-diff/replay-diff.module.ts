import { Inject, Module, type DynamicModule, type OnModuleDestroy } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { LiveRecords } from './live-records.js';
import { LIVE_RECORDS, ReplayDiffService } from './replay-diff.service.js';

const READONLY_POOL = Symbol('READONLY_POOL');

/**
 * Replay-diff context (plan S13): public market data, core rules and a
 * read-only pool of its own. Must never import DbModule (the server's
 * write-capable pool), a Binance trading module, an order executor or any
 * key/secret provider — enforced by test/replay-diff-isolation.test.ts.
 * The connection string is passed in by the CLI entry, which is the only
 * place that reads the environment.
 */
@Module({})
export class ReplayDiffModule implements OnModuleDestroy {
  constructor(@Inject(READONLY_POOL) private readonly pool: pg.Pool) {}

  static forUrl(connectionString: string): DynamicModule {
    return {
      module: ReplayDiffModule,
      imports: [MarketDataModule],
      providers: [
        { provide: READONLY_POOL, useFactory: () => new pg.Pool({ connectionString, max: 2 }) },
        { provide: LIVE_RECORDS, inject: [READONLY_POOL], useFactory: (pool: pg.Pool) => new LiveRecords(drizzle(pool)) },
        ReplayDiffService,
      ],
      exports: [ReplayDiffService],
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
