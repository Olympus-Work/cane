import { Logger, Module, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { FundingCandidateSource } from '../funding/funding.candidates.js';
import { FundingModule } from '../funding/funding.module.js';
import { FundingSync } from '../funding/funding.sync.js';
import { FundingSyncSchedule, parseSyncEnv } from './funding-sync.schedule.js';

const TICK_MS = 60_000;

/**
 * Live funding data, synced right after each settlement (plan F01, F01b). Off
 * while `FUNDING_SYNC_SYMBOLS` is unset and `FUNDING_SYNC_CANDIDATES` is not `true`.
 */
@Module({ imports: [FundingModule] })
export class FundingSyncScheduleModule implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('FundingSync');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly sync: FundingSync,
    private readonly source: FundingCandidateSource,
  ) {}

  onApplicationBootstrap(): void {
    const config = parseSyncEnv(process.env.FUNDING_SYNC_SYMBOLS, process.env.FUNDING_SYNC_CANDIDATES);
    if ('error' in config) {
      this.log.error(`${config.error}: live funding sync is off`);
      return;
    }
    const { whitelist, candidates } = config;
    if (whitelist.length === 0 && !candidates) {
      this.log.log('FUNDING_SYNC_SYMBOLS and FUNDING_SYNC_CANDIDATES are not set: live funding sync is off');
      return;
    }
    const schedule = new FundingSyncSchedule(this.sync, this.source, { whitelist, candidates }, Date.now);
    void schedule.tick();
    this.timer = setInterval(() => void schedule.tick(), TICK_MS);
    const what = [whitelist.length > 0 ? whitelist.join(', ') : null, candidates ? 'all scanner candidates' : null].filter(Boolean);
    this.log.log(`live funding sync after each settlement: ${what.join(' + ')}`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
