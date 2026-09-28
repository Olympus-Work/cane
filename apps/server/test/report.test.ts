import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { formatReplayReport } from '../src/replay/report.js';
import type { ReplayResult, ReplayTrade } from '../src/replay/replay.types.js';

const D = (s: string) => new Decimal(s);

function makeTrade(overrides: Partial<ReplayTrade>): ReplayTrade {
  return {
    side: 'long',
    kind: 'primary',
    signalTimeframe: '4h',
    signalOpenTime: Date.UTC(2024, 8, 29, 4),
    entryTime: Date.UTC(2024, 8, 29, 8),
    entryPrice: D('100'),
    initialStop: D('90'),
    stopSource: 'trail',
    takeProfit: null,
    trend1w: 'bullish',
    finalStop: D('100'),
    stopMoves: 0,
    exitTime: Date.UTC(2024, 8, 30, 8),
    exitPrice: D('120'),
    exitReason: 'first_red',
    r: D('2'),
    pct: D('20'),
    ...overrides,
  };
}

function makeResult(overrides: Partial<ReplayResult>): ReplayResult {
  return {
    pair: 'BTCUSDT',
    market: 'futures',
    from: Date.UTC(2024, 8, 29),
    to: Date.UTC(2026, 8, 28),
    evaluations: 42,
    trades: [],
    skipped: { 'none:trend_filter': 40, warming_up: 2 },
    candleCounts: { '4h': 100, '1d': 40, '1w': 10 },
    historyStart: { '4h': Date.UTC(2024, 8, 1), '1d': Date.UTC(2024, 8, 1), '1w': Date.UTC(2024, 8, 1) },
    historyGaps: [],
    ...overrides,
  };
}

describe('formatReplayReport', () => {
  it('renders the summary and trades for a result with two closed trades', () => {
    const result = makeResult({
      trades: [
        makeTrade({}),
        makeTrade({
          side: 'short',
          kind: 'late',
          entryPrice: D('50'),
          initialStop: D('55'),
          exitPrice: D('55'),
          exitReason: 'stop',
          r: D('-1'),
          pct: D('-10'),
        }),
      ],
    });
    const out = formatReplayReport([result], new Date(Date.UTC(2026, 8, 28, 12, 0, 0)));

    expect(out).toContain('# Replay report');
    expect(out).toContain(
      '| BTCUSDT | futures | 2024-09-29 → 2026-09-28 | 2 | 1 | 1 | 50.0 | 1.00 | 0.50 | 8.00 | no |',
    );
    expect(out).toContain('## BTCUSDT · futures');
    expect(out).toContain('first_red');
    expect(out).toContain('stop');
    expect(out).toContain('History gaps: none');
  });

  it('renders "No trades." and Win % "—" for a result with zero trades', () => {
    const out = formatReplayReport([makeResult({})], new Date(Date.UTC(2026, 8, 28, 12, 0, 0)));

    expect(out).toContain('No trades.');
    expect(out).toContain('| BTCUSDT | futures | 2024-09-29 → 2026-09-28 | 0 | 0 | 0 | — | 0.00 | — | 0.00 | no |');
  });
});
