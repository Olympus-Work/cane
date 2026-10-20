// One-off AC2 runner for F02 (the deployment DB is not reachable from this box).
// Same code path as the shipped CLI (FundingBacktestService + @cane/core rules +
// KlineCache), except funding comes from the public Binance endpoint through the
// F01 FundingClient + withIntervals instead of the funding_rate table.
// Run from apps/server with a built server: node tools/one-off-funding-backtest.mjs [cli options...]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Decimal } from 'decimal.js';
import { withIntervals } from '@cane/core';
import { FundingClient } from '../dist/funding/funding.client.js';
import { KlinesClient } from '../dist/market-data/klines.client.js';
import { KlineCache } from '../dist/market-data/kline-cache.js';
import { FundingBacktestService } from '../dist/funding-backtest/funding-backtest.service.js';
import { formatBacktestReport } from '../dist/funding-backtest/report.js';
import { backtestSettings } from '../dist/cli/funding-backtest.command.js';

// --- option parsing (same flags/defaults as the shipped CLI) ---
const argv = process.argv.slice(2);
const opts = {};
for (let i = 0; i < argv.length; i += 2) {
  const key = argv[i];
  const value = argv[i + 1];
  if (!key?.startsWith('--') || value === undefined) throw new Error(`bad args near "${key}"`);
  const list = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);
  switch (key.slice(2)) {
    case 'symbols': opts.symbols = list(value); break;
    case 'days': opts.days = Number(value); break;
    case 'n': opts.n = list(value).map((v) => Number(v)); break;
    case 'entry-apr': opts.entryApr = list(value).map((v) => new Decimal(v)); break;
    case 'exit-apr': opts.exitApr = list(value).map((v) => new Decimal(v)); break;
    case 'k': opts.k = list(value).map((v) => Number(v)); break;
    case 'breakeven-days': opts.breakevenDays = list(value).map((v) => new Decimal(v)); break;
    case 'spot-fee': opts.spotFee = new Decimal(value); break;
    case 'perp-fee': opts.perpFee = new Decimal(value); break;
    case 'slippage': opts.slippage = new Decimal(value); break;
    case 'leverage': opts.leverage = Number(value); break;
    case 'mmr': opts.mmr = new Decimal(value); break;
    case 'bnb-trades': opts.bnbTrades = Number(value); break;
    case 'notional': opts.notional = new Decimal(value); break;
    case 'out': break; // handled below
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

// --- market data through the shipped cache (same files as the replay) ---
const klines = new KlineCache(new KlinesClient(fetchFn, sleep), path.resolve('../data/klines/'));
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
