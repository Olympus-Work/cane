import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notifier } from '../src/engine/ports.js';
import type { DayDiff } from '../src/replay-diff/replay-diff.service.js';
import { ReplayDiffSchedule, dueDay, summary } from '../src/replay-diff-schedule/replay-diff.schedule.js';
import { childRunner } from '../src/replay-diff-schedule/replay-diff-schedule.module.js';

const at = (iso: string): number => Date.parse(iso);

describe('replay-diff schedule (plan S13)', () => {
  let notify: ReturnType<typeof vi.fn>;
  let notifier: Notifier;

  beforeEach(() => {
    notify = vi.fn().mockResolvedValue(undefined);
    notifier = { notify } as unknown as Notifier;
  });

  it('is due for the previous UTC day from 00:15 UTC', () => {
    expect(dueDay(at('2026-10-10T00:14:59Z'))).toBeNull();
    expect(dueDay(at('2026-10-10T00:15:00Z'))).toBe('2026-10-09');
    expect(dueDay(at('2026-10-10T23:59:00Z'))).toBe('2026-10-09');
  });

  it('runs once per day and sends one summary per strategy, also when all match', async () => {
    let now = at('2026-10-10T00:16:00Z');
    const result: DayDiff = {
      day: '2026-10-09',
      strategies: [{ strategyId: 'S-01', pair: 'BTCUSDT', market: 'futures', compared: 6, matched: 6, mismatches: [] }],
    };
    const run = vi.fn().mockResolvedValue(result);
    const s = new ReplayDiffSchedule(run, notifier, () => now);
    await s.tick();
    now += 60_000;
    await s.tick();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('2026-10-09');
    expect(notify).toHaveBeenCalledWith('replay_diff', 'S-01', { day: '2026-10-09', what: 'BTCUSDT futures: 6/6 match' });
    now = at('2026-10-11T00:15:00Z');
    await s.tick();
    expect(run).toHaveBeenLastCalledWith('2026-10-10');
  });

  it('notifies when no strategy was evaluated', async () => {
    const s = new ReplayDiffSchedule(vi.fn().mockResolvedValue({ day: '2026-10-09', strategies: [] }), notifier, () => at('2026-10-10T01:00:00Z'));
    await s.tick();
    expect(notify).toHaveBeenCalledWith('replay_diff', null, { day: '2026-10-09', what: 'no strategy evaluated' });
  });

  it('a failing run only notifies and is not retried the same day', async () => {
    const run = vi.fn().mockRejectedValue(new Error('REPLAY_DATABASE_URL is not set'));
    const s = new ReplayDiffSchedule(run, notifier, () => at('2026-10-10T01:00:00Z'));
    await s.tick();
    await s.tick();
    expect(run).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('replay_diff', null, { day: '2026-10-09', reason: 'check failed: REPLAY_DATABASE_URL is not set' });
  });

  it('summarises the first mismatch', () => {
    const line = summary({
      strategyId: 'S-01',
      pair: 'BTCUSDT',
      market: 'futures',
      compared: 6,
      matched: 5,
      mismatches: [{ key: at('2026-10-09T08:00:00Z'), outcome: 'differ', live: 'none:no_signal', replay: 'enter …' }],
    });
    expect(line).toBe('BTCUSDT futures: 5/6 match; differ 4h@2026-10-09T08:00Z (see server log)');
  });
});

describe('replay-diff child process env (plan S13 isolation)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cane-diff-'));
  // A stand-in CLI: prints the env keys it received as the result.
  const cli = join(dir, 'fake-cli.mjs');
  writeFileSync(cli, "process.stdout.write('noise\\n' + JSON.stringify({ day: process.argv.at(-1), strategies: [], env: Object.keys(process.env).sort() }) + '\\n');");
  chmodSync(cli, 0o644);

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('passes only PATH and REPLAY_DATABASE_URL, never the master key or DATABASE_URL', async () => {
    vi.stubEnv('CANE_MASTER_KEY', 'test-master-key');
    vi.stubEnv('DATABASE_URL', 'postgres://cane_server@x/db');
    vi.stubEnv('TRADING_ENABLED', 'true');
    try {
      const out = (await childRunner('postgres://cane_replay@x/db', cli)('2026-10-09')) as DayDiff & { env: string[] };
      expect(out.day).toBe('2026-10-09');
      expect(out.env).toEqual(expect.arrayContaining(['PATH', 'REPLAY_DATABASE_URL']));
      for (const k of ['CANE_MASTER_KEY', 'DATABASE_URL', 'TRADING_ENABLED']) expect(out.env).not.toContain(k);
      // Windows adds its own system variables to every child; Linux (Railway) adds none.
      if (process.platform !== 'win32') expect(out.env).toEqual(['PATH', 'REPLAY_DATABASE_URL']);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('rejects with the last stderr line when the child fails', async () => {
    const bad = join(dir, 'bad-cli.mjs');
    writeFileSync(bad, "process.stderr.write('REPLAY_DATABASE_URL is not set\\n'); process.exit(2);");
    await expect(childRunner('x', bad)('2026-10-09')).rejects.toThrow('REPLAY_DATABASE_URL is not set');
  });
});
