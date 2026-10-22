import { Logger } from '@nestjs/common';
import type { SettledFunding } from '@cane/core';
import { assertSymbol } from '../funding/funding.client.js';
import type { FundingCandidateSource, FundingTarget, TargetOptions } from '../funding/funding.candidates.js';
import type { FundingSync } from '../funding/funding.sync.js';

/** Sync this long after a settlement: Binance publishes the settled rate within seconds. */
export const SETTLE_GRACE_MS = 60_000;
/** A settlement not published yet is retried on every tick (one minute)... */
export const RETRY_MS = 60_000;
/** ...for this long; then it is logged and the symbol moves on to its next settlement. */
export const GIVE_UP_MS = 30 * 60_000;
/** Back-off of the whole schedule after a failed request (Binance down or rate limited). */
export const ERROR_RETRY_MS = 5 * 60_000;

/** `FUNDING_SYNC_SYMBOLS` → symbols; empty or unset = no whitelist. */
export function parseSyncSymbols(value: string | undefined): string[] {
  const symbols = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const s of symbols) assertSymbol(s, 'FUNDING_SYNC_SYMBOLS: invalid symbol');
  return symbols;
}

/** `FUNDING_SYNC_CANDIDATES` → add every scanner candidate (plan F01b). Only `true` turns it on. */
export function parseSyncCandidates(value: string | undefined): boolean {
  const v = (value ?? '').trim();
  if (v === '' || v === 'false') return false;
  if (v === 'true') return true;
  throw new Error(`FUNDING_SYNC_CANDIDATES: expected true or false, got "${v}"`);
}

/**
 * Live funding sync inside the server (plan F01b; owner 2026-10-15: right after
 * each settlement). Called every minute. A symbol is synced on its own the first
 * time the process sees it (history to its depth). After that, one bulk
 * premiumIndex call gives every symbol's next settlement, and one bulk
 * fundingRate call per settlement slot covers every symbol due then. Any failed
 * request pauses the whole schedule; nothing here touches trading.
 */
export class FundingSyncSchedule {
  private readonly log = new Logger('FundingSync');
  /** Symbols synced on their own since start. */
  private readonly seen = new Set<string>();
  /** Settlement each symbol waits for. */
  private readonly slots = new Map<string, number>();
  /** Last slot each symbol finished (synced or given up): an announced slot at or before it is ignored. */
  private readonly done = new Map<string, number>();
  private pausedUntil = 0;
  private running = false;

  constructor(
    private readonly sync: FundingSync,
    private readonly source: FundingCandidateSource,
    private readonly opts: TargetOptions,
    private readonly now: () => number,
  ) {}

  /** Settlement `symbol` is waiting for (for logs and tests). */
  slotOf(symbol: string): number | null {
    return this.slots.get(symbol) ?? null;
  }

  /** The schedule is paused after a failure until this time. */
  get pausedTill(): number {
    return this.pausedUntil;
  }

  async tick(): Promise<void> {
    if (this.running || this.now() < this.pausedUntil) return;
    this.running = true;
    try {
      await this.run();
    } catch (err) {
      this.log.error(`funding sync failed, pausing ${ERROR_RETRY_MS / 60_000} min: ${message(err)}`);
      this.pausedUntil = this.now() + ERROR_RETRY_MS;
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<void> {
    const { targets } = await this.source.targets(this.opts, this.now());
    const byName = new Map(targets.map((t) => [t.symbol, t]));
    for (const symbol of [...this.slots.keys()]) if (!byName.has(symbol)) this.slots.delete(symbol);
    for (const symbol of [...this.seen]) {
      if (!byName.has(symbol)) {
        this.seen.delete(symbol);
        this.done.delete(symbol);
      }
    }

    const synced: string[] = [];
    for (const t of targets) {
      if (this.seen.has(t.symbol)) continue;
      await this.syncOne(t);
      this.seen.add(t.symbol);
      synced.push(t.symbol);
    }

    if (targets.some((t) => !this.slots.has(t.symbol))) {
      const next = await this.sync.nextFundingTimes();
      for (const t of targets) {
        const slot = next.get(t.symbol);
        if (!this.slots.has(t.symbol) && slot !== undefined && slot > (this.done.get(t.symbol) ?? 0)) this.slots.set(t.symbol, slot);
      }
    }

    const due = new Map<number, FundingTarget[]>();
    for (const t of targets) {
      const slot = this.slots.get(t.symbol);
      if (slot !== undefined && this.now() >= slot + SETTLE_GRACE_MS) due.set(slot, [...(due.get(slot) ?? []), t]);
    }
    for (const [slot, group] of [...due].sort((a, b) => a[0] - b[0])) synced.push(...(await this.syncSlot(slot, group)));

    if (synced.length === 0) return;
    try {
      for (const warning of await this.sync.intervalMismatches(synced)) this.log.warn(warning);
    } catch (err) {
      this.log.warn(`fundingInfo check failed: ${message(err)}`);
    }
  }

  /** One bulk call for a settlement slot. Returns the symbols written. */
  private async syncSlot(slot: number, group: readonly FundingTarget[]): Promise<string[]> {
    const settled = await this.sync.settledAt(slot);
    if (settled === null) this.log.warn(`settlement ${iso(slot)}: bulk fundingRate page is full, syncing each symbol`);
    const out: string[] = [];
    const late: string[] = [];
    for (const t of group) {
      const rows: SettledFunding[] | undefined = settled === null ? undefined : settled.get(t.symbol);
      if (settled !== null && rows === undefined) {
        if (this.now() < slot + GIVE_UP_MS) continue; // not published yet: next tick
        late.push(t.symbol);
        this.slots.delete(t.symbol);
        this.done.set(t.symbol, slot);
        continue;
      }
      if (rows === undefined || !(await this.sync.appendSettled(t.symbol, rows))) await this.syncOne(t);
      this.slots.delete(t.symbol);
      this.done.set(t.symbol, slot);
      out.push(t.symbol);
    }
    if (late.length > 0) this.log.warn(`settlement ${iso(slot)} not published after 30 min: ${late.join(', ')}`);
    if (out.length > 0) this.log.log(`settlement ${iso(slot)}: ${out.length} symbols synced`);
    return out;
  }

  private async syncOne(t: FundingTarget): Promise<void> {
    const r = await this.sync.sync(t.symbol, t.from, this.now());
    if (r.added > 0) this.log.log(`${t.symbol}: +${r.added} funding events`);
  }
}

const iso = (ms: number) => new Date(ms).toISOString();

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
