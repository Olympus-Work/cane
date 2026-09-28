import { Module } from '@nestjs/common';
import { ReplayModule } from '../replay/replay.module.js';
import { ReplayCommand } from './replay.command.js';

/** CLI root for `replay`: loads ReplayModule only (no trading, no keys). */
@Module({
  imports: [ReplayModule],
  providers: [ReplayCommand],
})
export class ReplayCliModule {}
