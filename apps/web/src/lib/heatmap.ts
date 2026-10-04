// Pure helpers for the activity heatmap grid. No React, no DOM, no I/O.
// All date math runs on UTC calendar strings (Asia/Bangkok 'YYYY-MM-DD') so the
// machine's local time zone never leaks in.

export interface HeatmapCell {
  day: string;
  trades: number;
  wins: number;
  losses: number;
  pnl: string;
  level: 0 | 1 | 2 | 3 | 4;
  empty: boolean;
}

// Structural mirror of the API's HeatmapDay; kept local so this module has no
// import from api.ts.
interface HeatmapDay {
  day: string;
  trades: number;
  wins: number;
  losses: number;
  pnl: string;
  level: 0 | 1 | 2 | 3 | 4;
}

const DAY_MS = 86_400_000;

function parseUTC(day: string): number {
  const [y = 0, m = 0, d = 0] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function toISO(ts: number): string {
  const dt = new Date(ts);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function monthOf(day: string): number {
  return new Date(parseUTC(day)).getUTCMonth();
}

function emptyCell(day: string): HeatmapCell {
  return { day, trades: 0, wins: 0, losses: 0, pnl: '0', level: 0, empty: true };
}

export function buildGrid(items: HeatmapDay[], today: string, weeks: number): (HeatmapCell | null)[][] {
  const byDay = new Map<string, HeatmapDay>();
  for (const it of items) byDay.set(it.day, it);

  const todayTs = parseUTC(today);
  const lastSundayTs = todayTs - new Date(todayTs).getUTCDay() * DAY_MS;
  const grid: (HeatmapCell | null)[][] = [];

  for (let col = 0; col < weeks; col++) {
    const colSundayTs = lastSundayTs - (weeks - 1 - col) * 7 * DAY_MS;
    const column: (HeatmapCell | null)[] = [];
    for (let row = 0; row < 7; row++) {
      const day = toISO(colSundayTs + row * DAY_MS);
      // ISO dates compare lexicographically; only the last column holds days after today.
      column.push(day > today ? null : cellFor(byDay.get(day), day));
    }
    grid.push(column);
  }
  return grid;
}

function cellFor(item: HeatmapDay | undefined, day: string): HeatmapCell {
  return item ? { ...item, empty: false } : emptyCell(day);
}

export function monthLabels(grid: (HeatmapCell | null)[][]): { col: number; month: number }[] {
  const labels: { col: number; month: number }[] = [];
  let prevMonth: number | null = null;
  let lastCol = -Infinity;
  for (let col = 0; col < grid.length; col++) {
    const first = grid[col]?.[0];
    if (!first) continue;
    const month = monthOf(first.day);
    const isBoundary = prevMonth === null || month !== prevMonth;
    // Keep column 0 always; otherwise only when the last kept label is >= 3 cols back.
    if (isBoundary && (col === 0 || col - lastCol >= 3)) {
      labels.push({ col, month });
      lastCol = col;
    }
    prevMonth = month;
  }
  return labels;
}

export function summarize(cells: HeatmapCell[]): { activeDays: number; totalDays: number; longestStreak: number } {
  let activeDays = 0;
  let longestStreak = 0;
  let run = 0;
  for (const c of cells) {
    if (c.trades > 0) {
      activeDays++;
      run++;
      if (run > longestStreak) longestStreak = run;
    } else {
      run = 0;
    }
  }
  return { activeDays, totalDays: cells.length, longestStreak };
}

export function flatCells(grid: (HeatmapCell | null)[][]): HeatmapCell[] {
  const out: HeatmapCell[] = [];
  for (const col of grid) for (const cell of col) if (cell) out.push(cell);
  return out;
}
