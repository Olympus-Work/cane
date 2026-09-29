import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DbModule } from '../db/db.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { ResetPasswordCommand, ResetTotpCommand, SeedOwnerCommand } from './owner.commands.js';

/** CLI root for owner-account management: no engine, no market data, no trading. */
@Module({
  imports: [DbModule, AuditModule, SettingsModule, AuthModule],
  providers: [SeedOwnerCommand, ResetPasswordCommand, ResetTotpCommand],
})
export class OwnerCliModule {}
