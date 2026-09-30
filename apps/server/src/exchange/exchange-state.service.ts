import { Inject, Injectable } from '@nestjs/common';
import { EXCHANGE_READER, ExchangeReadError, type ExchangeReader, type ExchangeSnapshot } from './exchange-reader.js';

export interface ExchangeView {
  /** Latest good snapshot; null until one has ever succeeded. */
  snapshot: ExchangeSnapshot | null;
  /** When `snapshot` was read (ISO), null with it. */
  lastSyncAt: string | null;
  /** True when the latest refresh failed and `snapshot` is an older one (B16.9). */
  stale: boolean;
  /** Why the latest refresh failed; null when it succeeded. */
  error: 'no_key' | 'key_rejected' | 'unreachable' | null;
}

/**
 * Keeps the last good exchange snapshot so the dashboard can show dimmed
 * values with an error banner while Binance is unreachable (B16.9).
 */
@Injectable()
export class ExchangeStateService {
  private last: { snapshot: ExchangeSnapshot; at: number } | null = null;

  constructor(@Inject(EXCHANGE_READER) private readonly reader: ExchangeReader) {}

  async view(): Promise<ExchangeView> {
    try {
      const snapshot = await this.reader.snapshot();
      this.last = { snapshot, at: Date.now() };
      return { snapshot, lastSyncAt: new Date(this.last.at).toISOString(), stale: false, error: null };
    } catch (e) {
      if (!(e instanceof ExchangeReadError)) throw e;
      return { snapshot: this.last?.snapshot ?? null, lastSyncAt: this.last ? new Date(this.last.at).toISOString() : null, stale: this.last !== null, error: e.kind };
    }
  }
}
