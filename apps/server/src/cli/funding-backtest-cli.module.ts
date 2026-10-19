import { Module, type DynamicModule } from '@nestjs/common';
import { FundingBacktestModule } from '../funding-backtest/funding-backtest.module.js';
import { FundingBacktestCommand } from './funding-backtest.command.js';

/** CLI root for `funding-backtest`: backtest context only (no trading, no keys, read-only DB). */
@Module({})
export class FundingBacktestCliModule {
  static forUrl(connectionString: string): DynamicModule {
    return { module: FundingBacktestCliModule, imports: [FundingBacktestModule.forUrl(connectionString)], providers: [FundingBacktestCommand] };
  }
}
