import { Module } from '@nestjs/common';
import { ExchangeModule } from '../exchange/exchange.module.js';
import { StatsModule } from '../stats/stats.module.js';
import { StrategiesController } from './strategies.controller.js';

@Module({ imports: [ExchangeModule, StatsModule], controllers: [StrategiesController] })
export class StrategiesModule {}
