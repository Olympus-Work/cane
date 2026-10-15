import { Logger, Module, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { FundingModule } from '../funding/funding.module.js';
import { FundingSync } from '../funding/funding.sync.js';
import { FundingSyncSchedule, parseSyncSymbols } from './funding-sync.schedule.js';

const TICK_MS = 15 * 60_000;

/** Live funding data (plan F01). Off while `FUNDING_SYNC_SYMBOLS` is unset. */
@Module({ imports: [FundingModule] })
export class FundingSyncScheduleModule implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('FundingSync');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly sync: FundingSync) {}

  onApplicationBootstrap(): void {
    const symbols = parseSyncSymbols(process.env.FUNDING_SYNC_SYMBOLS);
    if (symbols.length === 0) {
      this.log.log('FUNDING_SYNC_SYMBOLS is not set: live funding sync is off');
      return;
    }
    const schedule = new FundingSyncSchedule(this.sync, symbols, Date.now);
    void schedule.tick();
    this.timer = setInterval(() => void schedule.tick(), TICK_MS);
    this.log.log(`live funding sync every 15 min: ${symbols.join(', ')}`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
