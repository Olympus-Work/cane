import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
import { cliServiceErrorHandler } from './cli/cli-error.js';
import { FundingCliModule } from './cli/funding-cli.module.js';

// Usage: node --env-file-if-exists=.env dist/funding-cli.js backfill | check [--symbols A,B] [--days N].
// Reads DATABASE_URL only (via DbModule); Binance access is public market data (plan F01).
await CommandFactory.run(FundingCliModule, { logger: ['warn', 'error'], serviceErrorHandler: cliServiceErrorHandler });
