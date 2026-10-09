import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DbModule } from './db/db.module.js';
import { EngineModule } from './engine/engine.module.js';
import { KillSwitchModule } from './kill-switch/kill-switch.module.js';
import { ReplayDiffScheduleModule } from './replay-diff-schedule/replay-diff-schedule.module.js';
import { NotifyModule } from './notify/notify.module.js';
import { HealthController } from './health/health.controller.js';
import { SettingsModule } from './settings/settings.module.js';
import { StrategiesModule } from './strategies/strategies.module.js';

@Module({
  imports: [DbModule, AuditModule, SettingsModule, NotifyModule, AuthModule, StrategiesModule, DashboardModule, EngineModule, KillSwitchModule, ReplayDiffScheduleModule],
  controllers: [HealthController],
})
export class AppModule {}
