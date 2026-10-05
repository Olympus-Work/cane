import { Module } from '@nestjs/common';
import { EngineModule } from '../engine/engine.module.js';
import { ExchangeModule } from '../exchange/exchange.module.js';
import { KillSwitchController } from './kill-switch.controller.js';

/** Kill switch endpoint (B11). Imported by AppModule only: it reaches the order executor, so the replay context must never load it. */
@Module({ imports: [EngineModule, ExchangeModule], controllers: [KillSwitchController] })
export class KillSwitchModule {}
