import { Decimal } from 'decimal.js';
import { ARB_NET_APR_HURDLE, type ArbPairResult } from '@cane/core';
import { symbolTotals, type BacktestResult, type SetRun, type Totals } from './funding-backtest.service.js';

/** Margin ratio levels L1/L2/L3 the stress table counts (spec B48, proposed 40/60/80%). */
export const MARGIN_LEVELS = [new Decimal('0.4'), new Decimal('0.6'), new Decimal('0.8')] as const;

const dateTime = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const dateOnly = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const usdt = (v: Decimal) => v.toFixed(2);
const pct = (v: Decimal, dp = 2) => v.times(100).toFixed(dp);
const pctOrDash = (v: Decimal | null) => (v === null ? '—' : pct(v, 1));

function row(cells: (string | number)[]): string {
  return `| ${cells.join(' | ')} |`;
}

function header(cells: string[]): string[] {
  return [row(cells), row(cells.map(() => '---'))];
}

function setLabel(s: SetRun): (string | number)[] {
  const p = s.params;
  return [s.id, p.n, pct(p.entryAprMin), pct(p.exitAprMin), p.k, p.maxBreakevenDays.toString()];
}

function totalsCells(t: Totals): (string | number)[] {
  return [
    t.pairs,
    pct(t.inPair, 1),
    usdt(t.funding),
    usdt(t.fees),
    usdt(t.slippage),
    usdt(t.basis),
    usdt(t.net),
    usdt(t.capital),
    pct(t.netApr),
    t.hurdleMet ? 'yes' : 'no',
    pctOrDash(t.worstMarginRatio),
  ];
}

/** The set the details are shown for: the best that meets the hurdle, else the best. */
export function topSet(result: BacktestResult): SetRun | undefined {
  return result.sets.find((s) => s.all.hurdleMet) ?? result.sets[0];
}

function pairRow(i: number, symbol: string, p: ArbPairResult): string {
  return row([
    i,
    symbol,
    dateTime(p.openTime),
    dateTime(p.closeTime),
    p.status,
    p.exitReason,
    pct(p.entryAvgApr),
    p.entryBreakevenDays.toFixed(1),
    p.settlements,
    usdt(p.funding),
    usdt(p.fees),
    usdt(p.slippage),
    usdt(p.basis),
    usdt(p.net),
    pct(p.maxAdverseMove),
    pct(p.maxMarginRatio, 1),
  ]);
}

/** Markdown report of a funding-arb backtest (plan F02 "Report"). */
export function formatBacktestReport(result: BacktestResult, generatedAt: Date): string {
  const s = result.settings;
  const c = s.costs;
  const lines: string[] = [];
  lines.push('# Funding-arb backtest');
  lines.push(`Generated: ${generatedAt.toISOString()}`);
  lines.push('');
  lines.push(
    `Window: ${dateOnly(s.from)} → ${dateOnly(s.to)} (${result.days.toFixed(1)} days). Symbols: ${s.symbols.join(', ')}. ` +
      `Notional per leg: ${usdt(s.notional)} USDT. Hurdle: net APR ≥ ${pct(ARB_NET_APR_HURDLE, 0)}% (spec B27.5).`,
  );
  lines.push('');
  lines.push('Assumptions (funding-arb plan F02 "Model"):');
  lines.push('- Decides at every settled funding event. Entry: avg funding APR over the last N ≥ entry APR, last rate > 0, break-even ≤ max days (B4, B5). Exit: avg < exit APR or the last K rates negative (B14).');
  lines.push('- Both legs fill at the 1h open of the settlement hour; the entry settlement is not earned, the exit settlement is. Same quantity on both legs, no step rounding.');
  lines.push(`- Fees per fill: spot ${pct(c.spotFee, 3)}%, perp ${pct(c.perpFee, 3)}%; slippage allowance ${pct(c.slippage, 3)}% per round trip, half at each side (B6).`);
  lines.push(`- Funding on the short = qty × mark × rate (mark from the funding row, else the perp 1h open).`);
  lines.push(
    `- Capital used = notional + margin at ${s.leverage}x + BNB buffer for ${s.bnbTrades} round trips (B23, B26), counted for the whole window. Net APR = net / capital used × 365 / days.`,
  );
  lines.push(`- Margin stress: worst perp 1h high while open, isolated, maintenance rate ${pct(s.mmr, 2)}%, funding not counted, no rebalance simulated. 100% = margin gone.`);
  lines.push('- A pair open at the window end is marked to market at the last 1h close, with exit costs.');
  lines.push('- This is evidence for choosing thresholds (spec AC2), not a forecast.');
  lines.push('');

  lines.push('## Data');
  lines.push('');
  lines.push(...header(['Symbol', 'Funding rows', 'First (UTC)', 'Last (UTC)', 'Intervals', 'Funding gaps', 'Spot 1h', 'Perp 1h', 'Settlements without a candle']));
  for (const d of result.data) {
    lines.push(
      row([
        d.symbol,
        d.fundingRows,
        d.first === null ? '—' : dateTime(d.first),
        d.last === null ? '—' : dateTime(d.last),
        d.intervals.map((i) => `${i.hours}h from ${dateOnly(i.from)}`).join(', ') || '—',
        d.gaps.length,
        d.spotCandles,
        d.perpCandles,
        d.missingCandles,
      ]),
    );
  }
  const gaps = result.data.flatMap((d) => d.gaps.map((g) => ({ symbol: d.symbol, g })));
  if (gaps.length > 0) {
    lines.push('');
    lines.push('Funding gaps (run `funding backfill`, then `funding check`):');
    for (const { symbol, g } of gaps) {
      const after = g.after === null ? 'start' : dateTime(g.after);
      const before = g.before === null ? 'end' : dateTime(g.before);
      lines.push(`- ${symbol}: ${g.reason}, ${after} → ${before} (${g.hours}h)`);
    }
  }
  lines.push('');

  lines.push('## Parameter sets');
  lines.push('');
  lines.push(`Ranked by net APR of all symbols together. ${result.sets.length} sets; money in USDT.`);
  lines.push('');
  lines.push(
    ...header([
      'Rank', 'Set', 'N', 'Entry APR %', 'Exit APR %', 'K', 'Break-even days', 'Symbol', 'Pairs', 'In pair %',
      'Funding', 'Fees', 'Slippage', 'Basis', 'Net', 'Capital used', 'Net APR %', 'Hurdle met', 'Worst margin ratio %',
    ]),
  );
  result.sets.forEach((set, rank) => {
    lines.push(row([rank + 1, ...setLabel(set), 'All', ...totalsCells(set.all)]));
    for (const sym of set.symbols) {
      lines.push(row(['', '', '', '', '', '', '', sym.symbol, ...totalsCells(symbolTotals(sym))]));
    }
  });
  lines.push('');

  const top = topSet(result);
  if (top) {
    const p = top.params;
    lines.push(`## Pairs of set ${top.id}`);
    lines.push('');
    lines.push(
      `N ${p.n}, entry ${pct(p.entryAprMin)}% / yr, exit ${pct(p.exitAprMin)}% / yr, K ${p.k}, break-even ≤ ${p.maxBreakevenDays.toString()} days. ` +
        `Net APR ${pct(top.all.netApr)}% (${top.all.hurdleMet ? 'meets' : 'below'} the hurdle).`,
    );
    lines.push('');
    const pairs = top.symbols.flatMap((sym) => sym.result.pairs.map((pair) => ({ symbol: sym.symbol, pair })));
    if (pairs.length === 0) {
      lines.push('No pair opened.');
    } else {
      lines.push(
        ...header([
          '#', 'Symbol', 'Open (UTC)', 'Close (UTC)', 'Status', 'Exit', 'Entry avg APR %', 'Break-even days', 'Settlements',
          'Funding', 'Fees', 'Slippage', 'Basis', 'Net', 'Max adverse move %', 'Max margin ratio %',
        ]),
      );
      pairs.sort((a, b) => a.pair.openTime - b.pair.openTime || a.symbol.localeCompare(b.symbol));
      pairs.forEach(({ symbol, pair }, i) => lines.push(pairRow(i + 1, symbol, pair)));
      lines.push('');
      lines.push('### Margin stress');
      lines.push('');
      lines.push(...header(['Symbol', 'Pairs', 'Worst adverse move %', 'Worst margin ratio %', ...MARGIN_LEVELS.map((l, i) => `≥ L${i + 1} ${pct(l, 0)}%`)]));
      for (const sym of top.symbols) {
        const ps = sym.result.pairs;
        if (ps.length === 0) continue;
        lines.push(
          row([
            sym.symbol,
            ps.length,
            pct(Decimal.max(...ps.map((x) => x.maxAdverseMove))),
            pct(Decimal.max(...ps.map((x) => x.maxMarginRatio)), 1),
            ...MARGIN_LEVELS.map((l) => ps.filter((x) => x.maxMarginRatio.gte(l)).length),
          ]),
        );
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}
