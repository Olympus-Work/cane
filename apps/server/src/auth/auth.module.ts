import { Global, Module } from '@nestjs/common';
import { NOTIFIER } from '../engine/engine.service.js';
import { LogNotifier } from '../engine/ports.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { FreshTotpGuard, SessionGuard } from './guards.js';

/** Owner login, sessions and the fresh-TOTP gate (B14). Needs AuditModule and SettingsModule (the SecretBox). */
@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionGuard, FreshTotpGuard, { provide: NOTIFIER, useClass: LogNotifier }],
  exports: [AuthService, SessionGuard, FreshTotpGuard],
})
export class AuthModule {}
