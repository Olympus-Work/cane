import { Global, Module } from '@nestjs/common';
import { NOTIFIER } from '../engine/engine.service.js';
import { NotifyController } from './notify.controller.js';
import { NOTIFY_FETCH, NotifyService } from './notify.service.js';

/** LINE push and Telegram (B13). Global: the engine and auth raise events through the `NOTIFIER` token. */
@Global()
@Module({
  controllers: [NotifyController],
  providers: [
    { provide: NOTIFY_FETCH, useValue: (url: string, init: RequestInit) => fetch(url, init) },
    NotifyService,
    { provide: NOTIFIER, useExisting: NotifyService },
  ],
  exports: [NOTIFIER, NotifyService],
})
export class NotifyModule {}
