import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Decimal } from 'decimal.js';
import { Command, CommandRunner, Option } from 'nest-commander';
import { assertSymbol } from '../funding/funding.client.js';
import { FundingBacktestService, type BacktestSettings } from '../funding-backtest/funding-backtest.service.js';
import { formatBacktestReport } from '../funding-backtest/report.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** CLI options as typed; percents are in % (APR in % / yr). Defaults: plan F02 "CLI". */
export interface FundingBacktestOptions {
  symbols?: string[];
  days?: number;
  n?: number[];
  entryApr?: Decimal[];
  exitApr?: Decimal[];
  k?: number[];
  breakevenDays?: Decimal[];
  spotFee?: Decimal;
  perpFee?: Decimal;
  slippage?: Decimal;
  leverage?: number;
  mmr?: Decimal;
  bnbTrades?: number;
  notional?: Decimal;
  out?: string;
}

export const BACKTEST_DEFAULTS = {
  symbols: ['BTCUSDT', 'ETHUSDT'],
  days: 730,
  n: [3, 9, 21],
  entryApr: ['5', '10', '15'],
  exitApr: ['0', '3'],
  k: [3],
  breakevenDays: ['10'],
  spotFee: '0.075',
  perpFee: '0.045',
  slippage: '0.05',
  leverage: 2,
  mmr: '0.5',
  bnbTrades: 10,
  notional: '10000',
} as const;

function list(value: string): string[] {
  const items = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) throw new Error('Expected a comma list');
  return items;
}

function wholeNumber(value: string, min: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new Error(`Expected a whole number >= ${min}, got "${value}"`);
  return n;
}

function decimal(value: string, { positive = false } = {}): Decimal {
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new Error(`Expected a number, got "${value}"`);
  const d = new Decimal(value);
  if (positive ? !d.gt(0) : d.lt(0)) throw new Error(`Expected a number ${positive ? '> 0' : '>= 0'}, got "${value}"`);
  return d;
}

const fromPct = (d: Decimal) => d.dividedBy(100);

/** Options (with defaults) → backtest settings, rates as fractions. `now` is the window end. */
export function backtestSettings(o: FundingBacktestOptions, now: number): BacktestSettings {
  const D = BACKTEST_DEFAULTS;
  const days = o.days ?? D.days;
  return {
    symbols: o.symbols ?? [...D.symbols],
    from: now - days * DAY_MS,
    to: now,
    grid: {
      n: o.n ?? [...D.n],
      entryAprMin: (o.entryApr ?? D.entryApr.map((v) => new Decimal(v))).map(fromPct),
      exitAprMin: (o.exitApr ?? D.exitApr.map((v) => new Decimal(v))).map(fromPct),
      k: o.k ?? [...D.k],
      maxBreakevenDays: o.breakevenDays ?? D.breakevenDays.map((v) => new Decimal(v)),
    },
    costs: {
      spotFee: fromPct(o.spotFee ?? new Decimal(D.spotFee)),
      perpFee: fromPct(o.perpFee ?? new Decimal(D.perpFee)),
      slippage: fromPct(o.slippage ?? new Decimal(D.slippage)),
    },
    leverage: o.leverage ?? D.leverage,
    mmr: fromPct(o.mmr ?? new Decimal(D.mmr)),
    bnbTrades: o.bnbTrades ?? D.bnbTrades,
    notional: o.notional ?? new Decimal(D.notional),
  };
}

@Command({
  name: 'funding-backtest',
  description: 'Backtest the funding-arb entry/exit rules over stored funding and public 1h klines; prints a Markdown report (plan F02)',
  options: { isDefault: true },
})
export class FundingBacktestCommand extends CommandRunner {
  constructor(private readonly backtest: FundingBacktestService) {
    super();
  }

  override async run(_args: string[], options: FundingBacktestOptions): Promise<void> {
    const settings = backtestSettings(options, Date.now());
    process.stderr.write(`funding-backtest ${settings.symbols.join(',')} ...\n`);
    const report = formatBacktestReport(await this.backtest.run(settings), new Date());
    if (options.out) {
      await mkdir(path.dirname(options.out), { recursive: true });
      await writeFile(options.out, report);
      process.stderr.write(`wrote ${options.out}\n`);
    } else {
      process.stdout.write(report);
    }
  }

  @Option({ flags: '--symbols <list>', description: `Comma list (default ${BACKTEST_DEFAULTS.symbols.join(',')})` })
  parseSymbols(value: string): string[] {
    const symbols = list(value);
    for (const s of symbols) assertSymbol(s);
    return symbols;
  }

  @Option({ flags: '--days <n>', description: `Window in days back from now (default ${BACKTEST_DEFAULTS.days})` })
  parseDays(value: string): number {
    return wholeNumber(value, 1);
  }

  @Option({ flags: '--n <list>', description: `N, settled intervals averaged (default ${BACKTEST_DEFAULTS.n.join(',')})` })
  parseN(value: string): number[] {
    return list(value).map((v) => wholeNumber(v, 1));
  }

  @Option({ flags: '--entry-apr <list>', description: `entry_apr_min in % / yr (default ${BACKTEST_DEFAULTS.entryApr.join(',')})` })
  parseEntryApr(value: string): Decimal[] {
    return list(value).map((v) => decimal(v));
  }

  @Option({ flags: '--exit-apr <list>', description: `exit_apr_min in % / yr (default ${BACKTEST_DEFAULTS.exitApr.join(',')})` })
  parseExitApr(value: string): Decimal[] {
    return list(value).map((v) => decimal(v));
  }

  @Option({ flags: '--k <list>', description: `K, negative rates in a row that exit (default ${BACKTEST_DEFAULTS.k.join(',')})` })
  parseK(value: string): number[] {
    return list(value).map((v) => wholeNumber(v, 1));
  }

  @Option({ flags: '--breakeven-days <list>', description: `max_breakeven_days (default ${BACKTEST_DEFAULTS.breakevenDays.join(',')})` })
  parseBreakevenDays(value: string): Decimal[] {
    return list(value).map((v) => decimal(v, { positive: true }));
  }

  @Option({ flags: '--spot-fee <pct>', description: `Spot fee per fill in % (default ${BACKTEST_DEFAULTS.spotFee})` })
  parseSpotFee(value: string): Decimal {
    return decimal(value);
  }

  @Option({ flags: '--perp-fee <pct>', description: `Perp fee per fill in % (default ${BACKTEST_DEFAULTS.perpFee}, taker)` })
  parsePerpFee(value: string): Decimal {
    return decimal(value);
  }

  @Option({ flags: '--slippage <pct>', description: `Slippage allowance per round trip in % (default ${BACKTEST_DEFAULTS.slippage})` })
  parseSlippage(value: string): Decimal {
    return decimal(value);
  }

  @Option({ flags: '--leverage <n>', description: `Perp leverage (default ${BACKTEST_DEFAULTS.leverage})` })
  parseLeverage(value: string): number {
    return wholeNumber(value, 1);
  }

  @Option({ flags: '--mmr <pct>', description: `Perp maintenance margin rate in % (default ${BACKTEST_DEFAULTS.mmr})` })
  parseMmr(value: string): Decimal {
    return decimal(value);
  }

  @Option({ flags: '--bnb-trades <n>', description: `BNB buffer in round trips (default ${BACKTEST_DEFAULTS.bnbTrades})` })
  parseBnbTrades(value: string): number {
    return wholeNumber(value, 0);
  }

  @Option({ flags: '--notional <usdt>', description: `Notional per leg in USDT (default ${BACKTEST_DEFAULTS.notional})` })
  parseNotional(value: string): Decimal {
    return decimal(value, { positive: true });
  }

  @Option({ flags: '--out <file>', description: 'Write the Markdown report to this file instead of stdout' })
  parseOut(value: string): string {
    return value;
  }
}
