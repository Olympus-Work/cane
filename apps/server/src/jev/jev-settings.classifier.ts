import type { JevCall, JevClassifier } from '../engine/ports.js';
import { UnavailableJev } from '../engine/ports.js';
import type { SettingsService } from '../settings/settings.service.js';
import { JEV_DEFAULT_TIMEOUT_MS, JevClient, type JevClientDeps, type JevFetch } from './jev.client.js';

/**
 * Reads the Jev key and timeout from Settings on every call (B8.4), so a change
 * in Settings needs no restart. `TYPESAFE_API_KEY` is only a fallback for local
 * development. No key means the B8.4 fallback (base size), never a crash.
 * The client is rebuilt only when the key or timeout changed, so the retry and
 * concurrency options (`JEV_MAX_*`) keep their shared in-flight count.
 */
export class SettingsJevClassifier implements JevClassifier {
  private current: { apiKey: string; timeoutMs: number; client: JevClient } | null = null;
  private readonly unavailable = new UnavailableJev();

  constructor(
    private readonly settings: SettingsService,
    private readonly fetchFn: JevFetch,
    private readonly now: () => number,
    private readonly options: Pick<JevClientDeps, 'maxRetries' | 'maxConcurrent'>,
    private readonly envKey: string | undefined,
  ) {}

  async classify(input: Parameters<JevClassifier['classify']>[0]): Promise<JevCall> {
    const apiKey = (await this.settings.getSecret('jev_api_key')) ?? this.envKey;
    if (!apiKey) return this.unavailable.classify();
    const timeoutMs = (await this.settings.getJevTimeoutMs()) ?? JEV_DEFAULT_TIMEOUT_MS;
    if (!this.current || this.current.apiKey !== apiKey || this.current.timeoutMs !== timeoutMs) {
      this.current = { apiKey, timeoutMs, client: new JevClient({ apiKey, fetch: this.fetchFn, now: this.now, timeoutMs, ...this.options }) };
    }
    return this.current.client.classify(input);
  }
}
