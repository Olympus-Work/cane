import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Inject, Logger, Module, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { NOTIFIER } from '../engine/engine.service.js';
import type { Notifier } from '../engine/ports.js';
import type { DayDiff } from '../replay-diff/replay-diff.service.js';
import { ReplayDiffSchedule, type RunDiff } from './replay-diff.schedule.js';

const TICK_MS = 60_000;
const CHILD_TIMEOUT_MS = 10 * 60_000;
const CLI = fileURLToPath(new URL('../replay-diff-cli.js', import.meta.url));

/**
 * Starts `replay-diff-cli.js` as a child process with a minimal env: PATH and
 * the read-only `REPLAY_DATABASE_URL` only, so the master key, DATABASE_URL and
 * TRADING_ENABLED never reach the diff (plan S13, replay isolation).
 */
export function childRunner(replayUrl: string, cli = CLI): RunDiff {
  return (day) =>
    new Promise<DayDiff>((resolve, reject) => {
      execFile(
        process.execPath,
        [cli, '--day', day],
        { env: { PATH: process.env.PATH ?? '', REPLAY_DATABASE_URL: replayUrl }, timeout: CHILD_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) return reject(new Error(stderr.trim().split('\n').at(-1) || err.message));
          try {
            resolve(JSON.parse(stdout.trim().split('\n').at(-1) ?? '') as DayDiff);
          } catch {
            reject(new Error('replay-diff printed no JSON result'));
          }
        },
      );
    });
}

/** Daily live == replay check (plan S13). Off while `REPLAY_DATABASE_URL` is unset. */
@Module({})
export class ReplayDiffScheduleModule implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('ReplayDiff');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(@Inject(NOTIFIER) private readonly notifier: Notifier) {}

  onApplicationBootstrap(): void {
    const url = process.env.REPLAY_DATABASE_URL;
    if (!url) {
      this.log.warn('REPLAY_DATABASE_URL is not set: the daily replay-diff is off');
      return;
    }
    const schedule = new ReplayDiffSchedule(childRunner(url), this.notifier, Date.now);
    this.timer = setInterval(() => void schedule.tick(), TICK_MS);
    this.log.log('daily replay-diff scheduled (00:15 UTC)');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
