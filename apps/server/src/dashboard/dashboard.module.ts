import { Module } from '@nestjs/common';
import { ExchangeModule } from '../exchange/exchange.module.js';
import { StatsModule } from '../stats/stats.module.js';
import { TradesController } from '../trades/trades.controller.js';
import { DashboardController } from './dashboard.controller.js';

/** Dashboard, trade history and detail (B16). */
@Module({ imports: [ExchangeModule, StatsModule], controllers: [DashboardController, TradesController] })
export class DashboardModule {}
