import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { FundingBackfillCommand, FundingCheckCommand } from '../funding/funding.commands.js';
import { FundingModule } from '../funding/funding.module.js';

/** CLI root for `funding`: DB + public funding data only (no trading, no settings, no keys). */
@Module({
  imports: [DbModule, FundingModule],
  providers: [FundingBackfillCommand, FundingCheckCommand],
})
export class FundingCliModule {}
