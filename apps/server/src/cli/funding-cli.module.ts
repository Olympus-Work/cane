import { type DynamicModule, Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { FUNDING_SYNC_SYMBOLS_ENV, FundingBackfillCommand, FundingCheckCommand } from '../funding/funding.commands.js';
import { FundingModule } from '../funding/funding.module.js';

/** CLI root for `funding`: DB + public funding data only (no trading, no settings, no keys). */
@Module({
  imports: [DbModule, FundingModule],
  providers: [FundingBackfillCommand, FundingCheckCommand],
})
export class FundingCliModule {
  /** The entry passes `FUNDING_SYNC_SYMBOLS` (plan F01b whitelist); nothing under cli/ reads env. */
  static withWhitelist(value: string | undefined): DynamicModule {
    return { module: FundingCliModule, providers: [{ provide: FUNDING_SYNC_SYMBOLS_ENV, useValue: value ?? '' }] };
  }
}
