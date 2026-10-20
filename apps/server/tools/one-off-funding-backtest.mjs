// One-off AC2 runner for F02 (the deployment DB is not reachable from this box).
// Same code path as the shipped CLI (FundingBacktestService + @cane/core rules +
// KlineCache + the CLI's exported option parsers), except funding comes from the
// public Binance endpoint through the F01 FundingClient + withIntervals instead of
// the funding_rate table. REMOVE after the DB-backed AC2 rerun (plan F02 "Proof"):
// this file is plain JavaScript outside tsconfig (src, test only) and imports built
// output from dist/, so a constructor change surfaces only at run time.
// Run from apps/server with a built server: node tools/one-off-funding-backtest.mjs [cli options...]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withIntervals } from '@cane/core';
import { FundingClient } from '../dist/funding/funding.client.js';
import { KlinesClient } from '../dist/market-data/klines.client.js';
import { KlineCache, DEFAULT_KLINE_CACHE_DIR } from '../dist/market-data/kline-cache.js';
import { FundingBacktestService } from '../dist/funding-backtest/funding-backtest.service.js';
import { formatBacktestReport } from '../dist/funding-backtest/report.js';
import { backtestSettings, decimal, list, wholeNumber } from '../dist/cli/funding-backtest.command.js';

// --- option parsing: the shipped CLI's parsers, so validation cannot drift apart ---
const argv = process.argv.slice(2);
const opts = {};
for (let i = 0; i < argv.length; i += 2) {
  const key = argv[i];
  const value = argv[i + 1];
  if (!key?.startsWith('--') || value === undefined) throw new Error(`bad args near "${key}"`);
  switch (key.slice(2)) {
    case 'symbols': opts.symbols = list(value); break;
    case 'days': opts.days = wholeNumber(value, 1); break;
    case 'n': opts.n = list(value).map((v) => wholeNumber(v, 1)); break;
    case 'entry-apr': opts.entryApr = list(value).map((v) => decimal(v)); break;
    case 'exit-apr': opts.exitApr = list(value).map((v) => decimal(v)); break;
    case 'k': opts.k = list(value).map((v) => wholeNumber(v, 1)); break;
    case 'breakeven-days': opts.breakevenDays = list(value).map((v) => decimal(v, { positive: true })); break;
    case 'spot-fee': opts.spotFee = decimal(value); break;
    case 'perp-fee': opts.perpFee = decimal(value); break;
    case 'slippage': opts.slippage = decimal(value); break;
    case 'leverage': opts.leverage = wholeNumber(value, 1); break;
    case 'mmr': opts.mmr = decimal(value); break;
    case 'bnb-trades': opts.bnbTrades = wholeNumber(value, 0); break;
    case 'notional': opts.notional = decimal(value, { positive: true }); break;
    case 'out': break; // read below with its index
    default: throw new Error(`unknown option ${key}`);
  }
}
const outIdx = argv.indexOf('--out');
const out = outIdx >= 0 ? argv[outIdx + 1] : null;
const settings = backtestSettings(opts, Date.now());

// --- funding reader over the public endpoint (F01 client, same parsing as backfill) ---
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fetchFn = (url, init) => fetch(url, init);
const fundingClient = new FundingClient(fetchFn, sleep);
const funding = {
  async range(symbol, from, to) {
    const settled = await fundingClient.fundingHistory(symbol, from, to);
    return withIntervals(settled, { fallbackIntervalHours: 8 });
  },
};

// --- market data through the shipped cache at the shipped default dir (shared with the replay) ---
const klines = new KlineCache(new KlinesClient(fetchFn, sleep), DEFAULT_KLINE_CACHE_DIR);
const service = new FundingBacktestService(klines, funding);

process.stderr.write(`funding-backtest(http) ${settings.symbols.join(',')} window=${settings.from}..${settings.to} sets=${settings.grid.n.length * settings.grid.entryAprMin.length * settings.grid.exitAprMin.length * settings.grid.k.length * settings.grid.maxBreakevenDays.length}\n`);
const result = await service.run(settings);
const report = formatBacktestReport(result, new Date());
if (out) {
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(out, report);
  process.stderr.write(`wrote ${out}\n`);
} else {
  process.stdout.write(report);
}
