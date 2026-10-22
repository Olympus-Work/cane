import { Inject } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';
import { CANDIDATE_DEPTH_DAYS, fundingGaps } from '@cane/core';
import { parseSyncSymbols } from '../funding-sync-schedule/funding-sync.schedule.js';
import { FundingCandidateSource, type TargetList } from './funding.candidates.js';
import { assertSymbol } from './funding.client.js';
import { FundingStore } from './funding.store.js';
import { FundingSync } from './funding.sync.js';

export const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
export const DEFAULT_DAYS = 730;
/** Nest token for the `FUNDING_SYNC_SYMBOLS` value; the CLI module reads the env (funding/ never does). */
export const FUNDING_SYNC_SYMBOLS_ENV = Symbol('FUNDING_SYNC_SYMBOLS_ENV');

interface FundingOptions {
  symbols?: string[];
  days?: number;
  candidates?: boolean;
  candidateDays?: number;
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

/** `--symbols`, else `FUNDING_SYNC_SYMBOLS` (the whitelist until F15), else BTCUSDT,ETHUSDT. */
export function whitelistOf(options: FundingOptions, env: string | undefined): string[] {
  if (options.symbols) return options.symbols;
  const fromEnv = parseSyncSymbols(env);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_SYMBOLS;
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

abstract class FundingCommand extends CommandRunner {
  constructor(
    protected readonly source: FundingCandidateSource,
    private readonly whitelistEnv: string,
  ) {
    super();
  }

  @Option({ flags: '--symbols <list>', description: `Comma list (default FUNDING_SYNC_SYMBOLS, else ${DEFAULT_SYMBOLS.join(',')})` })
  parseSymbols(value: string): string[] {
    return parseSymbols(value);
  }

  @Option({ flags: '--days <n>', description: `Window of those symbols in days back from now (default ${DEFAULT_DAYS})` })
  parseDays(value: string): number {
    return parseDays(value);
  }

  @Option({ flags: '--candidates', description: 'Also every scanner candidate: USDT perpetual with a spot market (plan F01b)' })
  parseCandidates(): boolean {
    return true;
  }

  @Option({ flags: '--candidate-days <n>', description: `Window of the other candidates (default ${CANDIDATE_DEPTH_DAYS})` })
  parseCandidateDays(value: string): number {
    return parseDays(value);
  }

  protected targets(options: FundingOptions, now: number): Promise<TargetList> {
    return this.source.targets(
      {
        whitelist: whitelistOf(options, this.whitelistEnv),
        candidates: options.candidates ?? false,
        depthDays: { whitelist: options.days ?? DEFAULT_DAYS, candidate: options.candidateDays ?? CANDIDATE_DEPTH_DAYS },
      },
      now,
    );
  }
}

@Command({ name: 'backfill', description: 'Fetch settled funding history into funding_rate (plan F01, F01b)' })
export class FundingBackfillCommand extends FundingCommand {
  constructor(
    source: FundingCandidateSource,
    @Inject(FUNDING_SYNC_SYMBOLS_ENV) whitelistEnv: string,
    private readonly sync: FundingSync,
  ) {
    super(source, whitelistEnv);
  }

  override async run(_args: string[], options: FundingOptions): Promise<void> {
    const now = Date.now();
    const { targets } = await this.targets(options, now);
    let added = 0;
    for (const t of targets) {
      const r = await this.sync.sync(t.symbol, t.from, now);
      added += r.added;
      process.stdout.write(`${JSON.stringify({ symbol: t.symbol, days: t.depthDays, added: r.added, newest: iso(r.newest) })}\n`);
    }
    process.stdout.write(`${JSON.stringify({ summary: { symbols: targets.length, added } })}\n`);
  }
}

@Command({ name: 'check', description: 'Row counts, interval changes and gaps in funding_rate; exit 1 on any gap (AC1, F01b)' })
export class FundingCheckCommand extends FundingCommand {
  constructor(
    source: FundingCandidateSource,
    @Inject(FUNDING_SYNC_SYMBOLS_ENV) whitelistEnv: string,
    private readonly store: FundingStore,
  ) {
    super(source, whitelistEnv);
  }

  override async run(_args: string[], options: FundingOptions): Promise<void> {
    const now = Date.now();
    const { targets, noSpot } = await this.targets(options, now);
    const withGaps: string[] = [];
    const listedLate: string[] = [];
    for (const t of targets) {
      const events = await this.store.range(t.symbol, t.from, now);
      const gaps = fundingGaps(events, t.from, now);
      if (gaps.length > 0) withGaps.push(t.symbol);
      if (t.listedAt !== null) listedLate.push(t.symbol);
      const intervalChanges = events
        .filter((e, i) => i === 0 || e.intervalHours !== events[i - 1]!.intervalHours)
        .map((e) => ({ from: iso(e.fundingTime), hours: e.intervalHours }));
      const report = {
        symbol: t.symbol,
        days: t.depthDays,
        window: { from: iso(t.from), to: iso(now) },
        ...(t.listedAt !== null ? { listed: iso(t.listedAt) } : {}),
        rows: events.length,
        first: iso(events[0]?.fundingTime ?? null),
        last: iso(events.at(-1)?.fundingTime ?? null),
        intervals: intervalChanges,
        gaps: gaps.map((g) => ({ reason: g.reason, after: iso(g.after), before: iso(g.before), hours: g.hours })),
      };
      process.stdout.write(`${JSON.stringify(report)}\n`);
    }
    const summary = {
      symbols: targets.length,
      covered: targets.length - withGaps.length,
      withGaps,
      listedInsideWindow: listedLate,
      ...(options.candidates ? { excludedNoSpot: { count: noSpot.length, symbols: noSpot } } : {}),
    };
    process.stdout.write(`${JSON.stringify({ summary })}\n`);
    if (withGaps.length > 0) process.exitCode = 1;
  }
}
