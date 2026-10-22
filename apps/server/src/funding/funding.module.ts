import { Module } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DB } from '../db/db.module.js';
import { FETCH_FN, type FetchFn } from '../market-data/klines.client.js';
import { FundingCandidateSource } from './funding.candidates.js';
import { DEFAULT_FUNDING_PACE_MS, FUNDING_PACE_MS, FundingClient } from './funding.client.js';
import { FundingStore } from './funding.store.js';
import { FundingSync } from './funding.sync.js';

/**
 * Funding data (funding-arb plan F01): public `/fapi` market data and the
 * `funding_rate` table. No API key, no signed or order endpoint; uses the
 * global DbModule. Enforced for the CLI by test/funding-cli-isolation.test.ts.
 */
@Module({
  providers: [
    FundingClient,
    { provide: FUNDING_PACE_MS, useValue: DEFAULT_FUNDING_PACE_MS },
    { provide: FETCH_FN, useValue: ((url: string, init?: { method?: string }): Promise<unknown> => fetch(url, init)) as FetchFn },
    { provide: FundingStore, inject: [DB], useFactory: (db: NodePgDatabase) => new FundingStore(db) },
    { provide: FundingSync, inject: [FundingClient, FundingStore], useFactory: (c: FundingClient, s: FundingStore) => new FundingSync(c, s) },
    { provide: FundingCandidateSource, inject: [FundingClient], useFactory: (c: FundingClient) => new FundingCandidateSource(c) },
  ],
  exports: [FundingStore, FundingSync, FundingCandidateSource],
})
export class FundingModule {}
