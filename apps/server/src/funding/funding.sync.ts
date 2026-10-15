import { hoursBetween, withIntervals, type FundingEvent } from '@cane/core';
import type { FundingClient } from './funding.client.js';
import type { FundingStore } from './funding.store.js';

export interface SyncResult {
  symbol: string;
  added: number;
  newest: number | null;
}

/**
 * Keeps `funding_rate` complete for one symbol (spec B1, plan F01): fills
 * history back to `from` and forward to `now`. Intervals come from the
 * exchange's timestamps (B2). Running it twice adds nothing the second time.
 */
export class FundingSync {
  constructor(
    private readonly client: FundingClient,
    private readonly store: FundingStore,
  ) {}

  async sync(symbol: string, from: number, now: number): Promise<SyncResult> {
    let added = 0;
    const oldest = await this.store.oldest(symbol);
    const newest = await this.store.newest(symbol);

    if (!oldest || !newest) {
      const fetched = await this.client.fundingHistory(symbol, from, now);
      if (fetched.length === 0) return { symbol, added: 0, newest: null };
      const fallbackIntervalHours =
        fetched.length === 1 ? await this.nextIntervalHours(symbol, fetched[0]!.fundingTime) : undefined;
      const events = withIntervals(fetched, { fallbackIntervalHours });
      await this.store.upsert(symbol, events);
      return { symbol, added: events.length, newest: events.at(-1)!.fundingTime };
    }

    // History before the oldest stored event (a longer window than the last run).
    if (from < oldest.fundingTime) {
      const head = await this.client.fundingHistory(symbol, from, oldest.fundingTime - 1);
      if (head.length > 0) {
        const events = withIntervals(head, { fallbackIntervalHours: oldest.intervalHours });
        await this.store.upsert(symbol, events);
        added += events.length;
      }
    }

    // Settlements after the newest stored event.
    const tail = await this.client.fundingHistory(symbol, newest.fundingTime + 1, now);
    let newestTime = newest.fundingTime;
    if (tail.length > 0) {
      const events: FundingEvent[] = withIntervals(tail, {
        previousTime: newest.fundingTime,
        previousIntervalHours: newest.intervalHours,
      });
      await this.store.upsert(symbol, events);
      added += events.length;
      newestTime = events.at(-1)!.fundingTime;
    }
    return { symbol, added, newest: newestTime };
  }

  /**
   * Compares the newest stored interval with `/fapi/v1/fundingInfo` (symbols
   * whose interval was adjusted). Returns one message per mismatch.
   */
  async intervalMismatches(symbols: readonly string[]): Promise<string[]> {
    const info = new Map((await this.client.fundingInfo()).map((i) => [i.symbol, i.fundingIntervalHours]));
    const out: string[] = [];
    for (const symbol of symbols) {
      const listed = info.get(symbol);
      const newest = await this.store.newest(symbol);
      if (listed !== undefined && newest && newest.intervalHours !== listed) {
        out.push(`${symbol}: fundingInfo says ${listed}h, stored history says ${newest.intervalHours}h`);
      }
    }
    return out;
  }

  /** Interval from a lone settled event to the next settlement the exchange announces. */
  private async nextIntervalHours(symbol: string, fundingTime: number): Promise<number> {
    const premium = await this.client.premiumIndex(symbol);
    return hoursBetween(fundingTime, premium.nextFundingTime);
  }
}
