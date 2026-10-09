import { Module, type DynamicModule } from '@nestjs/common';
import { ReplayDiffModule } from '../replay-diff/replay-diff.module.js';
import { ReplayDiffCommand } from './replay-diff.command.js';

/** CLI root for `replay-diff`: replay-diff context only (no trading, no keys, read-only DB). */
@Module({})
export class ReplayDiffCliModule {
  static forUrl(connectionString: string): DynamicModule {
    return { module: ReplayDiffCliModule, imports: [ReplayDiffModule.forUrl(connectionString)], providers: [ReplayDiffCommand] };
  }
}
