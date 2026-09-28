import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { ReplayService } from './replay.service.js';

/**
 * Replay context (plan S01 / S13): public market data + core rules only.
 * Must never import a Binance trading module, an order executor or any
 * key/secret provider — enforced by test/replay-isolation.test.ts.
 */
@Module({
  imports: [MarketDataModule],
  providers: [ReplayService],
  exports: [ReplayService],
})
export class ReplayModule {}
