import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Put, Req, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { ne } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Market } from '@cane/core';
import { AuditService } from '../audit/audit.service.js';
import { FreshTotpGuard, SessionGuard } from '../auth/guards.js';
import { ctxOf, optStr, str, type AuthedRequest } from '../auth/http.js';
import { hintOf } from '../auth/secret-box.js';
import { DB } from '../db/db.module.js';
import { strategies } from '../db/schema.js';
import { NOTIFIER } from '../engine/engine.service.js';
import type { Notifier } from '../engine/ports.js';
import { KeyCheckError, judgeKey, PERMISSION_CHECKER, type BinancePermissionChecker, type KeyVerdict } from './binance-permissions.js';
import { JEV_TIMEOUT_MAX_MS, JEV_TIMEOUT_MIN_MS, SettingsService, type SecretKey } from './settings.service.js';

/** Owner Settings (B13, B15, B8.4). Every value is write-only: reads return hints (last 4 characters). */
@Controller('v1/settings')
@UseGuards(SessionGuard)
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Inject(DB) private readonly db: NodePgDatabase,
    @Inject(PERMISSION_CHECKER) private readonly permissions: BinancePermissionChecker,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
  ) {}

  @Get()
  async read() {
    return { secrets: await this.settings.hints(), jevTimeoutMs: await this.settings.getJevTimeoutMs() };
  }

  /** B15: save the Binance key after checking its permissions. Nothing is stored if the check fails. */
  @Put('binance-key')
  @HttpCode(200)
  @UseGuards(FreshTotpGuard)
  async binanceKey(@Body() body: unknown, @Req() req: AuthedRequest) {
    const apiKey = str(body, 'apiKey', 256);
    const apiSecret = str(body, 'apiSecret', 256);
    const used = await this.db.selectDistinct({ market: strategies.market }).from(strategies).where(ne(strategies.status, 'closed'));
    let verdict: KeyVerdict;
    try {
      verdict = judgeKey(await this.permissions.check({ apiKey, apiSecret }), used.map((r) => r.market as Market));
    } catch (e) {
      if (e instanceof KeyCheckError) throw new UnprocessableEntityException(e.message);
      throw e;
    }
    if (!verdict.ok) throw new UnprocessableEntityException(verdict.message);
    const before = (await this.settings.hints()).binance_api_key;
    await this.settings.setSecrets({ binance_api_key: apiKey, binance_api_secret: apiSecret });
    await this.audit.record({ actor: 'owner', action: 'key_change', target: 'binance', before: { apiKey: before }, after: { apiKey: hintOf(apiKey) }, ip: ctxOf(req).ip });
    await this.notifier.notify('settings_changed', null, { what: 'Binance key' });
    return { apiKey: hintOf(apiKey) };
  }

  /** B13: LINE / Telegram targets. Only the fields sent are changed. */
  @Put('notifications')
  @HttpCode(200)
  @UseGuards(FreshTotpGuard)
  async notifications(@Body() body: unknown, @Req() req: AuthedRequest) {
    const fields: Array<[string, SecretKey]> = [
      ['lineChannelToken', 'line_channel_token'],
      ['lineUserId', 'line_user_id'],
      ['telegramBotToken', 'telegram_bot_token'],
      ['telegramChatId', 'telegram_chat_id'],
    ];
    const changes = fields.flatMap(([field, key]) => {
      const v = optStr(body, field, 512);
      return v === undefined ? [] : [{ key, v }];
    });
    if (changes.length === 0) throw new BadRequestException('Nothing to change');
    const before = await this.settings.hints();
    await this.settings.setSecrets(Object.fromEntries(changes.map((c) => [c.key, c.v])));
    await this.audit.record({
      actor: 'owner',
      action: 'notification_change',
      before: Object.fromEntries(changes.map((c) => [c.key, before[c.key]])),
      after: Object.fromEntries(changes.map((c) => [c.key, hintOf(c.v)])),
      ip: ctxOf(req).ip,
    });
    await this.notifier.notify('settings_changed', null, { what: 'Notification targets' });
    return { changed: changes.map((c) => c.key) };
  }

  /** B8.4: Jev API key and timeout (default 3 s when never set). */
  @Put('jev')
  @HttpCode(200)
  @UseGuards(FreshTotpGuard)
  async jev(@Body() body: unknown, @Req() req: AuthedRequest) {
    const apiKey = optStr(body, 'apiKey', 256);
    const raw = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).timeoutMs : undefined;
    if (raw !== undefined && (typeof raw !== 'number' || !Number.isInteger(raw) || raw < JEV_TIMEOUT_MIN_MS || raw > JEV_TIMEOUT_MAX_MS)) {
      throw new BadRequestException(`timeoutMs must be a whole number from ${JEV_TIMEOUT_MIN_MS} to ${JEV_TIMEOUT_MAX_MS}`);
    }
    if (apiKey === undefined && raw === undefined) throw new BadRequestException('Nothing to change');
    const before = { apiKey: (await this.settings.hints()).jev_api_key, timeoutMs: await this.settings.getJevTimeoutMs() };
    if (apiKey !== undefined) await this.settings.setSecret('jev_api_key', apiKey);
    if (raw !== undefined) await this.settings.setJevTimeoutMs(raw as number);
    const after = { apiKey: apiKey === undefined ? before.apiKey : hintOf(apiKey), timeoutMs: (raw as number | undefined) ?? before.timeoutMs };
    await this.audit.record({ actor: 'owner', action: 'jev_change', before, after, ip: ctxOf(req).ip });
    await this.notifier.notify('settings_changed', null, { what: 'Jev settings' });
    return after;
  }
}
