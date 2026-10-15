import { Logger } from '@nestjs/common';
import type { FundingSync } from '../funding/funding.sync.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** On an empty table the first live sync also backfills this much history (plan F01, AC1 window). */
export const LIVE_HISTORY_DAYS = 730;

/** `FUNDING_SYNC_SYMBOLS` → symbols; empty or unset = off. */
export function parseSyncSymbols(value: string | undefined): string[] {
  const symbols = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const s of symbols) {
    if (!/^[A-Z0-9]{2,20}$/.test(s)) throw new Error(`FUNDING_SYNC_SYMBOLS: invalid symbol "${s}"`);
  }
  return symbols;
}

/**
 * Live funding sync inside the server (plan F01). Each tick syncs every
 * symbol and cross-checks the interval with `/fapi/v1/fundingInfo`. Errors are
 * logged and retried next tick; nothing here touches trading.
 */
export class FundingSyncSchedule {
  private readonly log = new Logger('FundingSync');
  private running = false;

  constructor(
    private readonly sync: FundingSync,
    private readonly symbols: readonly string[],
    private readonly now: () => number,
  ) {}

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.now();
      for (const symbol of this.symbols) {
        try {
          const r = await this.sync.sync(symbol, now - LIVE_HISTORY_DAYS * DAY_MS, now);
          if (r.added > 0) this.log.log(`${symbol}: +${r.added} funding events`);
        } catch (err) {
          this.log.error(`${symbol}: funding sync failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      try {
        for (const warning of await this.sync.intervalMismatches(this.symbols)) this.log.warn(warning);
      } catch (err) {
        this.log.warn(`fundingInfo check failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      this.running = false;
    }
  }
}
