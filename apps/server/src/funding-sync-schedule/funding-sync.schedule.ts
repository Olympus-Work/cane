import { Logger } from '@nestjs/common';
import { assertSymbol } from '../funding/funding.client.js';
import type { FundingSync } from '../funding/funding.sync.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** On an empty table the first live sync also backfills this much history (plan F01, AC1 window). */
export const LIVE_HISTORY_DAYS = 730;
/** Sync this long after a settlement: Binance publishes the settled rate within seconds. */
export const SETTLE_GRACE_MS = 60_000;
/** A settlement not published yet is retried at this pace... */
export const RETRY_MS = 60_000;
/** ...for this long; then it is logged and the symbol moves on to its next settlement. */
export const GIVE_UP_MS = 30 * 60_000;
/** Back-off after a failed request (Binance down or rate limited). */
export const ERROR_RETRY_MS = 5 * 60_000;

/** `FUNDING_SYNC_SYMBOLS` → symbols; empty or unset = off. */
export function parseSyncSymbols(value: string | undefined): string[] {
  const symbols = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const s of symbols) assertSymbol(s, 'FUNDING_SYNC_SYMBOLS: invalid symbol');
  return symbols;
}

interface SymbolState {
  /** Next time this symbol is synced. */
  dueAt: number;
  /** Settlement the next sync must find (null before the first sync). */
  expected: number | null;
}

/**
 * Live funding sync inside the server (plan F01, owner 2026-10-15: sync right
 * after each settlement). Called every minute; a symbol is synced once its
 * announced settlement time plus a grace period has passed, and retried each
 * minute until that settlement shows up. Errors are logged and retried; nothing
 * here touches trading.
 */
export class FundingSyncSchedule {
  private readonly log = new Logger('FundingSync');
  private readonly state = new Map<string, SymbolState>();
  private running = false;

  constructor(
    private readonly sync: FundingSync,
    private readonly symbols: readonly string[],
    private readonly now: () => number,
  ) {}

  /** When each symbol is next synced (for logs and tests). */
  dueAt(symbol: string): number {
    return this.state.get(symbol)?.dueAt ?? 0;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let synced = false;
      for (const symbol of this.symbols) {
        if (this.now() >= this.dueAt(symbol)) synced = (await this.syncSymbol(symbol)) || synced;
      }
      if (!synced) return;
      try {
        for (const warning of await this.sync.intervalMismatches(this.symbols)) this.log.warn(warning);
      } catch (err) {
        this.log.warn(`fundingInfo check failed: ${message(err)}`);
      }
    } finally {
      this.running = false;
    }
  }

  /** Returns true when a sync request ran. */
  private async syncSymbol(symbol: string): Promise<boolean> {
    const now = this.now();
    const expected = this.state.get(symbol)?.expected ?? null;
    try {
      const r = await this.sync.sync(symbol, now - LIVE_HISTORY_DAYS * DAY_MS, now);
      if (r.added > 0) this.log.log(`${symbol}: +${r.added} funding events`);
      const found = expected === null || (r.newest !== null && r.newest >= expected - SETTLE_GRACE_MS);
      if (!found && now < expected + GIVE_UP_MS) {
        this.state.set(symbol, { dueAt: now + RETRY_MS, expected });
        return true;
      }
      if (!found) this.log.warn(`${symbol}: settlement ${new Date(expected).toISOString()} not published after 30 min`);
      const next = await this.sync.nextFundingTime(symbol);
      this.state.set(symbol, { dueAt: next + SETTLE_GRACE_MS, expected: next });
    } catch (err) {
      this.log.error(`${symbol}: funding sync failed: ${message(err)}`);
      this.state.set(symbol, { dueAt: now + ERROR_RETRY_MS, expected });
    }
    return true;
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
