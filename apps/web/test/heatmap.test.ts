import { describe, expect, it } from 'vitest';
import { buildGrid, flatCells, monthLabels, summarize, type HeatmapCell } from '../src/lib/heatmap.js';

type Day = Parameters<typeof buildGrid>[0][number];

function day(day: string, trades: number, pnl: string, level: HeatmapCell['level'] = 1): Day {
  return { day, trades, wins: trades, losses: 0, pnl, level };
}

describe('buildGrid', () => {
  it('Sunday today: last column is [cell, null x6], first column is the prior week', () => {
    const grid = buildGrid([], '2026-09-27', 2);
    expect(grid).toHaveLength(2);
    expect(grid[1]![0]?.day).toBe('2026-09-27');
    for (let r = 1; r < 7; r++) expect(grid[1]![r]).toBeNull();
    expect(grid[0]!.map((c) => c?.day)).toEqual([
      '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26',
    ]);
  });

  it('Wednesday today: last column has 4 cells then 3 nulls', () => {
    const grid = buildGrid([], '2026-09-23', 1);
    expect(grid[0]!.map((c) => (c ? c.day : null))).toEqual([
      '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', null, null, null,
    ]);
  });

  it('places items into the right cell and fills the rest as empty cells', () => {
    const grid = buildGrid([day('2026-09-22', 3, '12.5', 2)], '2026-09-27', 2);
    const cell = grid[0]![2]; // Tuesday, first (older) week
    expect(cell).toEqual({ day: '2026-09-22', trades: 3, wins: 3, losses: 0, pnl: '12.5', level: 2, empty: false });
    const empty = grid[0]![0];
    expect(empty).toEqual({ day: '2026-09-20', trades: 0, wins: 0, losses: 0, pnl: '0', level: 0, empty: true });
  });
});

describe('monthLabels', () => {
  it('labels months 4..8 in order across a 20-week grid ending 2026-09-27', () => {
    const grid = buildGrid([], '2026-09-27', 20);
    expect(monthLabels(grid).map((l) => l.month)).toEqual([4, 5, 6, 7, 8]);
  });

  it('always labels column 0 and skips labels closer than 3 columns', () => {
    // 4 weeks, all in one month: only column 0 is labelled.
    const grid = buildGrid([], '2026-09-27', 4);
    expect(monthLabels(grid)).toEqual([{ col: 0, month: 8 }]);
  });
});

describe('summarize', () => {
  it('counts active days and the longest streak, breaking the run on a gap', () => {
    const cells: HeatmapCell[] = [
      { day: 'a', trades: 2, wins: 1, losses: 1, pnl: '1', level: 1, empty: false },
      { day: 'b', trades: 1, wins: 1, losses: 0, pnl: '2', level: 1, empty: false },
      { day: 'c', trades: 0, wins: 0, losses: 0, pnl: '0', level: 0, empty: true },
      { day: 'd', trades: 1, wins: 0, losses: 1, pnl: '-1', level: 1, empty: false },
      { day: 'e', trades: 1, wins: 1, losses: 0, pnl: '3', level: 1, empty: false },
      { day: 'f', trades: 2, wins: 2, losses: 0, pnl: '4', level: 2, empty: false },
    ];
    expect(summarize(cells)).toEqual({ activeDays: 5, totalDays: 6, longestStreak: 3 });
  });

  it('reports zero streak when there are no active days', () => {
    const cells = buildGrid([], '2026-09-27', 2).flat().filter((c): c is HeatmapCell => c !== null);
    expect(summarize(cells)).toEqual({ activeDays: 0, totalDays: 8, longestStreak: 0 });
  });
});

describe('flatCells', () => {
  it('returns every non-null cell oldest first', () => {
    const grid = buildGrid([day('2026-09-27', 1, '0.5')], '2026-09-27', 2);
    const flat = flatCells(grid);
    expect(flat).toHaveLength(8); // 7 (week 1) + 1 (week 2, Sunday only)
    expect(flat[0]!.day).toBe('2026-09-20');
    expect(flat[7]!.day).toBe('2026-09-27');
    expect(flat[7]!.empty).toBe(false);
  });
});

describe('weeks = 53', () => {
  it('gives exactly 53 columns of 7 entries', () => {
    const grid = buildGrid([], '2026-09-27', 53);
    expect(grid).toHaveLength(53);
    for (const col of grid) expect(col).toHaveLength(7);
    expect(grid[0]![0]?.day).toBe('2025-09-28'); // 52 weeks before 2026-09-27
  });
});
