import { Logger } from '@nestjs/common';
import type { Notifier } from '../engine/ports.js';
import { previousUtcDay } from '../replay/diff.js';
import type { DayDiff, StrategyDiff } from '../replay-diff/replay-diff.service.js';

/** Runs the diff for one UTC day in its own process (plan S13) and returns its JSON result. */
export type RunDiff = (day: string) => Promise<DayDiff>;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Run from 00:15 UTC: a missing 16:00 row only counts once the next day's 00:00:30 row exists (plan S13). */
export const RUN_AFTER_MS = 15 * 60 * 1000;

/** The previous UTC day once it may be checked (from 00:15 UTC), else null. */
export function dueDay(nowMs: number): string | null {
  const intoDay = nowMs % DAY_MS;
  if (intoDay < RUN_AFTER_MS) return null;
  return previousUtcDay(nowMs);
}

/** One line per strategy, e.g. `BTCUSDT futures: 6/6 match` or `… 4/6 match; differ 4h@…`. */
export function summary(s: StrategyDiff): string {
  const head = `${s.pair} ${s.market}: ${s.matched}/${s.compared} match`;
  if (s.mismatches.length === 0) return head;
  const first = s.mismatches[0]!;
  return `${head}; ${first.outcome} 4h@${new Date(first.key).toISOString().slice(0, 16)}Z (see server log)`;
}

/**
 * Daily replay-diff trigger inside the server (plan S13). It only starts the
 * isolated child process, logs its result and notifies; a failure is
 * reported and never touches trading.
 */
export class ReplayDiffSchedule {
  private readonly log = new Logger('ReplayDiff');
  private lastDay: string | null = null;
  private running = false;

  constructor(
    private readonly runDiff: RunDiff,
    private readonly notifier: Notifier,
    private readonly now: () => number,
  ) {}

  /** Called every minute: runs once per day for the previous UTC day. */
  async tick(): Promise<void> {
    const day = dueDay(this.now());
    if (day === null || day === this.lastDay || this.running) return;
    this.running = true;
    this.lastDay = day;
    try {
      const result = await this.runDiff(day);
      this.log.log(`replay-diff ${day}: ${JSON.stringify(result)}`);
      if (result.strategies.length === 0) {
        await this.notifier.notify('replay_diff', null, { day, what: 'no strategy evaluated' });
      }
      for (const s of result.strategies) {
        await this.notifier.notify('replay_diff', s.strategyId, { day, what: summary(s) });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.log.error(`replay-diff ${day} failed: ${reason}`);
      await this.notifier.notify('replay_diff', null, { day, reason: `check failed: ${reason}` });
    } finally {
      this.running = false;
    }
  }
}
