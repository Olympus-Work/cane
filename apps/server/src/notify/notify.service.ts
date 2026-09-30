import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DB } from '../db/db.module.js';
import { notifications } from '../db/schema.js';
import type { NotifyEvent, Notifier } from '../engine/ports.js';
import { SettingsService } from '../settings/settings.service.js';
import { lineChannel, telegramChannel, type Channel, type NotifyFetch, type SendResult } from './channels.js';
import { renderMessage, type NotifyDetails } from './templates.js';

export const NOTIFY_FETCH = Symbol('NOTIFY_FETCH');

/** Attempt n (0-based) is due this long after the row was created (plan, "Notification choices in S09"). */
export const RETRY_DUE_MS = [0, 30_000, 120_000, 300_000, 900_000] as const;
export const MAX_ATTEMPTS = RETRY_DUE_MS.length;
const WORKER_INTERVAL_MS = 15_000;

export type ChannelName = 'line' | 'telegram';

/**
 * B13: `notify` only queues one outbox row per configured channel and returns;
 * it never throws and never waits for the network, so trading is never blocked
 * (B13.2). A worker delivers the pending rows and retries failures.
 */
@Injectable()
export class NotifyService implements Notifier, OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Notify');
  private timer: ReturnType<typeof setInterval> | undefined;
  private delivering = false;

  constructor(
    @Inject(DB) private readonly db: NodePgDatabase,
    private readonly settings: SettingsService,
    @Inject(NOTIFY_FETCH) private readonly fetchFn: NotifyFetch,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.deliverDue(), WORKER_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async notify(event: NotifyEvent, strategyId: string | null, details: NotifyDetails): Promise<void> {
    try {
      this.log.log(`${event} ${strategyId ?? '-'}`);
      const names = await this.configuredChannels();
      if (names.length === 0) return;
      const message = renderMessage(event, strategyId, details);
      await this.db.insert(notifications).values(names.map((channel) => ({ event, channel, message })));
      void this.deliverDue();
    } catch (e) {
      // Only the error class: a message could echo a query or a token.
      this.log.error(`could not queue ${event} (${e instanceof Error ? e.name : 'unknown'})`);
    }
  }

  /** Sends every pending row that is due. Safe to call at any time; one run at a time. */
  async deliverDue(now: Date = new Date()): Promise<void> {
    if (this.delivering) return;
    this.delivering = true;
    try {
      const pending = await this.db.select().from(notifications).where(eq(notifications.status, 'pending')).orderBy(asc(notifications.id)).limit(100);
      const due = pending.filter((r) => now.getTime() >= r.createdAt.getTime() + (RETRY_DUE_MS[r.attempts] ?? 0));
      await Promise.all(due.map((r) => this.deliver(r, now)));
    } catch (e) {
      this.log.error(`delivery run failed (${e instanceof Error ? e.name : 'unknown'})`);
    } finally {
      this.delivering = false;
    }
  }

  private async deliver(row: typeof notifications.$inferSelect, now: Date): Promise<void> {
    // Claim the attempt first, so a second run can never send the same row twice.
    const claimed = await this.db
      .update(notifications)
      .set({ attempts: row.attempts + 1 })
      .where(and(eq(notifications.id, row.id), eq(notifications.status, 'pending'), eq(notifications.attempts, row.attempts)))
      .returning({ id: notifications.id });
    if (claimed.length === 0) return;

    const channel = await this.channel(row.channel);
    const result: SendResult = channel ? await channel.send(row.message) : { ok: false, error: 'channel is no longer configured' };
    if (result.ok) {
      await this.db.update(notifications).set({ status: 'sent', sentAt: now, lastError: null }).where(eq(notifications.id, row.id));
    } else {
      const status = !channel || row.attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'pending';
      await this.db.update(notifications).set({ status, lastError: result.error }).where(eq(notifications.id, row.id));
    }
  }

  /** B13.4: sends at once and reports the outcome; nothing is queued. */
  async sendTest(name: ChannelName): Promise<SendResult> {
    const channel = await this.channel(name);
    if (!channel) return { ok: false, error: 'This channel is not set up in Settings.' };
    return channel.send('Cane test message: this channel is working.');
  }

  private async configuredChannels(): Promise<ChannelName[]> {
    const names: ChannelName[] = [];
    for (const n of ['line', 'telegram'] as const) if (await this.channel(n)) names.push(n);
    return names;
  }

  /** A channel exists only when both of its Settings are saved. Read on every use, so a change applies at once. */
  private async channel(name: ChannelName): Promise<Channel | null> {
    if (name === 'line') {
      const [channelToken, userId] = await Promise.all([this.settings.getSecret('line_channel_token'), this.settings.getSecret('line_user_id')]);
      return channelToken && userId ? lineChannel({ channelToken, userId }, this.fetchFn) : null;
    }
    const [botToken, chatId] = await Promise.all([this.settings.getSecret('telegram_bot_token'), this.settings.getSecret('telegram_chat_id')]);
    return botToken && chatId ? telegramChannel({ botToken, chatId }, this.fetchFn) : null;
  }
}
