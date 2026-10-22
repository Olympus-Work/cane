import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
import { cliServiceErrorHandler } from './cli/cli-error.js';
import { FundingCliModule } from './cli/funding-cli.module.js';

// Usage: node --env-file-if-exists=.env dist/funding-cli.js backfill | check [--symbols A,B] [--days N].
// Reads DATABASE_URL (via DbModule) and FUNDING_SYNC_SYMBOLS (the whitelist until F15); Binance access is public market data (plan F01).
await CommandFactory.run(FundingCliModule.withWhitelist(process.env.FUNDING_SYNC_SYMBOLS), { logger: ['warn', 'error'], serviceErrorHandler: cliServiceErrorHandler });
