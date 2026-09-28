import { Decimal } from 'decimal.js';
import type { ReplayResult, ReplayTrade } from './replay.types.js';

const HISTORY_TFS = ['1w', '1d', '4h'] as const;

function dateOnly(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function dateTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

function fmtPrice(p: Decimal): string {
  if (p.gte(100)) return p.toFixed(2);
  if (p.gte(1)) return p.toFixed(3);
  return p.toFixed(4);
}

function isClosed(t: ReplayTrade): boolean {
  return t.exitReason !== 'open';
}

function summaryRow(r: ReplayResult): string {
  const closed = r.trades.filter(isClosed);
  const wins = closed.filter((t) => t.r.gt(0)).length;
  const losses = closed.length - wins;
  const winPct = closed.length === 0 ? '—' : new Decimal(wins).div(closed.length).times(100).toFixed(1);
  const sumR = closed.reduce((acc, t) => acc.plus(t.r), new Decimal(0)).toFixed(2);
  const avgR = closed.length === 0 ? '—' : new Decimal(sumR).div(closed.length).toFixed(2);
  const compounded = closed
    .reduce((acc, t) => acc.times(new Decimal(1).plus(t.pct.div(100))), new Decimal(1))
    .minus(1)
    .times(100)
    .toFixed(2);
  const open = r.trades.find((t) => t.exitReason === 'open');
  const openAtEnd = open ? `yes (${open.side})` : 'no';
  const window = `${dateOnly(r.from)} → ${dateOnly(r.to)}`;
  return `| ${r.pair} | ${r.market} | ${window} | ${closed.length} | ${wins} | ${losses} | ${winPct} | ${sumR} | ${avgR} | ${compounded} | ${openAtEnd} |`;
}

function skippedList(r: ReplayResult): string {
  const entries = Object.entries(r.skipped).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (entries.length === 0) return 'none';
  return entries.map(([key, count]) => `${key} ×${count}`).join(', ');
}

function tradeRow(i: number, t: ReplayTrade): string {
  const signal = `${t.signalTimeframe} ${dateTime(t.signalOpenTime)}`;
  const trend1w = t.trend1w ?? '—';
  const tp = t.takeProfit === null ? '—' : fmtPrice(t.takeProfit);
  const exitTime = t.exitTime === null ? '—' : dateTime(t.exitTime);
  return [
    String(i + 1),
    t.side,
    t.kind,
    signal,
    trend1w,
    dateTime(t.entryTime),
    fmtPrice(t.entryPrice),
    fmtPrice(t.initialStop),
    t.stopSource,
    tp,
    fmtPrice(t.finalStop),
    String(t.stopMoves),
    exitTime,
    fmtPrice(t.exitPrice),
    t.exitReason,
    t.r.toFixed(2),
    t.pct.toFixed(2),
  ]
    .map((cell) => ` ${cell} `)
    .join('|');
}

const TRADES_HEADER =
  '| # | Side | Kind | Signal | 1W | Entry time (UTC) | Entry | Initial stop | Stop src | TP | Final stop | Moves | Exit time (UTC) | Exit | Reason | R | % |';
const TRADES_DIVIDER =
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';

function resultSection(r: ReplayResult): string {
  const lines: string[] = [];
  lines.push(`## ${r.pair} · ${r.market}`);
  lines.push('');
  lines.push('History loaded:');
  for (const tf of HISTORY_TFS) {
    const count = r.candleCounts[tf] ?? 0;
    const start = r.historyStart[tf];
    lines.push(`- ${tf} ${count} candles from ${start === undefined ? '—' : dateOnly(start)}`);
  }
  lines.push(`- Evaluations: ${r.evaluations}`);
  lines.push(`- Skipped decisions: ${skippedList(r)}`);
  lines.push('');
  if (r.historyGaps.length > 0) {
    lines.push('History gaps (exchange side):');
    for (const gap of r.historyGaps) {
      lines.push(`- ${gap.timeframe} after ${dateTime(gap.afterOpenTime)} UTC: ${gap.missing} candle(s) missing`);
    }
  } else {
    lines.push('History gaps: none');
  }
  lines.push('');
  if (r.trades.length === 0) {
    lines.push('No trades.');
  } else {
    lines.push(TRADES_HEADER);
    lines.push(TRADES_DIVIDER);
    r.trades.forEach((t, i) => lines.push(`|${tradeRow(i, t)}|`));
  }
  return lines.join('\n');
}

export function formatReplayReport(results: ReplayResult[], generatedAt: Date): string {
  const lines: string[] = [];
  lines.push('# Replay report');
  lines.push(`Generated: ${generatedAt.toISOString()}`);
  lines.push(
    'Decisions the live rules (packages/core `decide`) would have made on Binance closed candles, evaluated at every 4H close. Unsized, no fees, no funding, no Jev confluence (base rules only). Stops and take-profits are simulated on 4H highs/lows (a gap through the level fills at the 4H open; if stop and take-profit are both inside one 4H candle, the stop is assumed first). Entries fill at the signal candle close. This is evidence for spec AC1, not a performance forecast.',
  );
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Pair | Market | Window | Trades | Wins | Losses | Win % | Sum R | Avg R | Compounded % (unsized) | Open at end |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of results) {
    lines.push(summaryRow(r));
  }
  for (const r of results) {
    lines.push('');
    lines.push(resultSection(r));
  }
  return lines.join('\n') + '\n';
}
