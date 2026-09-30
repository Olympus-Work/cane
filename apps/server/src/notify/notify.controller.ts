import { BadRequestException, Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/guards.js';
import { NotifyService, type ChannelName } from './notify.service.js';

@Controller('v1/settings/notifications')
@UseGuards(SessionGuard)
export class NotifyController {
  constructor(private readonly notify: NotifyService) {}

  /** B13.4: "send test message" per channel. It changes nothing, so a session is enough. */
  @Post('test')
  @HttpCode(200)
  async test(@Body() body: unknown) {
    const channel = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).channel : undefined;
    if (channel !== 'line' && channel !== 'telegram') throw new BadRequestException('channel must be "line" or "telegram"');
    const r = await this.notify.sendTest(channel as ChannelName);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }
}
