import { Command, CommandRunner, Option } from 'nest-commander';
import { fundingGaps } from '@cane/core';
import { assertSymbol } from './funding.client.js';
import { FundingStore } from './funding.store.js';
import { FundingSync } from './funding.sync.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
export const DEFAULT_DAYS = 730;

interface FundingOptions {
  symbols?: string[];
  days?: number;
}

function parseSymbols(value: string): string[] {
  const symbols = value.split(',').map((s) => s.trim()).filter(Boolean);
  for (const s of symbols) assertSymbol(s);
  if (symbols.length === 0) throw new Error('No symbol given');
  return symbols;
}

function parseDays(value: string): number {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1) throw new Error(`Expected a whole number of days, got "${value}"`);
  return days;
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

abstract class FundingCommand extends CommandRunner {
  @Option({ flags: '--symbols <list>', description: `Comma list (default ${DEFAULT_SYMBOLS.join(',')})` })
  parseSymbols(value: string): string[] {
    return parseSymbols(value);
  }

  @Option({ flags: '--days <n>', description: `Window in days back from now (default ${DEFAULT_DAYS})` })
  parseDays(value: string): number {
    return parseDays(value);
  }
}

@Command({ name: 'backfill', description: 'Fetch settled funding history into funding_rate (plan F01)' })
export class FundingBackfillCommand extends FundingCommand {
  constructor(private readonly sync: FundingSync) {
    super();
  }

  override async run(_args: string[], options: FundingOptions): Promise<void> {
    const now = Date.now();
    const from = now - (options.days ?? DEFAULT_DAYS) * DAY_MS;
    for (const symbol of options.symbols ?? DEFAULT_SYMBOLS) {
      const r = await this.sync.sync(symbol, from, now);
      process.stdout.write(`${JSON.stringify({ symbol, added: r.added, newest: iso(r.newest) })}\n`);
    }
  }
}

@Command({ name: 'check', description: 'Row counts, interval changes and gaps in funding_rate; exit 1 on any gap (AC1)' })
export class FundingCheckCommand extends FundingCommand {
  constructor(private readonly store: FundingStore) {
    super();
  }

  override async run(_args: string[], options: FundingOptions): Promise<void> {
    const now = Date.now();
    const from = now - (options.days ?? DEFAULT_DAYS) * DAY_MS;
    let gapCount = 0;
    for (const symbol of options.symbols ?? DEFAULT_SYMBOLS) {
      const events = await this.store.range(symbol, from, now);
      const gaps = fundingGaps(events, from, now);
      gapCount += gaps.length;
      const intervalChanges = events
        .filter((e, i) => i === 0 || e.intervalHours !== events[i - 1]!.intervalHours)
        .map((e) => ({ from: iso(e.fundingTime), hours: e.intervalHours }));
      const report = {
        symbol,
        window: { from: iso(from), to: iso(now) },
        rows: events.length,
        first: iso(events[0]?.fundingTime ?? null),
        last: iso(events.at(-1)?.fundingTime ?? null),
        intervals: intervalChanges,
        gaps: gaps.map((g) => ({ reason: g.reason, after: iso(g.after), before: iso(g.before), hours: g.hours })),
      };
      process.stdout.write(`${JSON.stringify(report)}\n`);
    }
    if (gapCount > 0) process.exitCode = 1;
  }
}
