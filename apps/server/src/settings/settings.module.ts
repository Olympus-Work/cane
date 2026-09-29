import { Global, Module } from '@nestjs/common';
import { SECRET_BOX } from '../auth/auth.service.js';
import { SecretBox, parseMasterKey } from '../auth/secret-box.js';
import { BinanceApiPermissionChecker, PERMISSION_CHECKER } from './binance-permissions.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

/** Encrypted Settings (B13, B15, B8.4). Needs `CANE_MASTER_KEY`: the server refuses to start without it. */
@Global()
@Module({
  controllers: [SettingsController],
  providers: [
    { provide: SECRET_BOX, useFactory: (): SecretBox => new SecretBox(parseMasterKey(process.env.CANE_MASTER_KEY)) },
    { provide: PERMISSION_CHECKER, useFactory: () => new BinanceApiPermissionChecker((url, init) => fetch(url, init)) },
    SettingsService,
  ],
  exports: [SECRET_BOX, PERMISSION_CHECKER, SettingsService],
})
export class SettingsModule {}
