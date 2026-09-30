import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { SECRET_BOX } from '../auth/auth.service.js';
import { hintOf, type SecretBox } from '../auth/secret-box.js';
import type { BinanceCredentials } from '../binance/rest.client.js';
import { DB } from '../db/db.module.js';
import { settings } from '../db/schema.js';

/** Secrets: stored AES-GCM encrypted with a last-4 hint (B15.1); never returned by the API. */
export const SECRET_KEYS = [
  'binance_api_key',
  'binance_api_secret',
  'jev_api_key',
  'line_channel_token',
  'line_user_id',
  'telegram_bot_token',
  'telegram_chat_id',
] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

const JEV_TIMEOUT_KEY = 'jev_timeout_ms';
/** B8.4 default and the bounds accepted for the Setting. */
export const JEV_TIMEOUT_MIN_MS = 500;
export const JEV_TIMEOUT_MAX_MS = 10_000;

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly db: NodePgDatabase,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
  ) {}

  async setSecret(key: SecretKey, plain: string): Promise<void> {
    await this.setSecrets({ [key]: plain });
  }

  /** All-or-nothing, so a pair such as the Binance key and secret is never half saved. */
  async setSecrets(entries: Partial<Record<SecretKey, string>>): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const [key, plain] of Object.entries(entries) as Array<[SecretKey, string]>) {
        const valueEnc = this.box.encrypt(plain);
        const hint = hintOf(plain);
        await tx
          .insert(settings)
          .values({ key, valueEnc, hint })
          .onConflictDoUpdate({ target: settings.key, set: { valueEnc, value: null, hint, updatedAt: new Date() } });
      }
    });
  }

  async getSecret(key: SecretKey): Promise<string | null> {
    const [row] = await this.db.select({ valueEnc: settings.valueEnc }).from(settings).where(eq(settings.key, key));
    return row?.valueEnc ? this.box.decrypt(row.valueEnc) : null;
  }

  /** For the Settings screen: which secrets are set and their last 4 characters. Never the values. */
  async hints(): Promise<Record<SecretKey, string | null>> {
    const rows = await this.db.select({ key: settings.key, hint: settings.hint }).from(settings);
    const byKey = new Map(rows.map((r) => [r.key, r.hint]));
    return Object.fromEntries(SECRET_KEYS.map((k) => [k, byKey.get(k) ?? null])) as Record<SecretKey, string | null>;
  }

  async binanceCredentials(): Promise<BinanceCredentials | null> {
    const [apiKey, apiSecret] = await Promise.all([this.getSecret('binance_api_key'), this.getSecret('binance_api_secret')]);
    return apiKey && apiSecret ? { apiKey, apiSecret } : null;
  }

  /** Null = not set, so the caller uses the B8.4 default (3 s). */
  async getJevTimeoutMs(): Promise<number | null> {
    const [row] = await this.db.select({ value: settings.value }).from(settings).where(eq(settings.key, JEV_TIMEOUT_KEY));
    return typeof row?.value === 'number' ? row.value : null;
  }

  async setJevTimeoutMs(ms: number): Promise<void> {
    await this.db
      .insert(settings)
      .values({ key: JEV_TIMEOUT_KEY, value: ms })
      .onConflictDoUpdate({ target: settings.key, set: { value: ms, valueEnc: null, hint: null, updatedAt: new Date() } });
  }
}
