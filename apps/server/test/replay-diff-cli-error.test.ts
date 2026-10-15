import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandFactory } from 'nest-commander';
import { cliErrorMessage, cliServiceErrorHandler } from '../src/cli/cli-error.js';
import { ReplayDiffCliModule } from '../src/cli/replay-diff-cli.module.js';

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

function captureStderr(): string[] {
  const chunks: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  });
  return chunks;
}

describe('cliErrorMessage', () => {
  it('prefers the driver error in `cause` over a multi-line query error', () => {
    const err = new Error('Failed query: select 1\nparams: 2026-10-14', { cause: new Error('connect ECONNREFUSED 127.0.0.1:1') });
    expect(cliErrorMessage(err)).toBe('connect ECONNREFUSED 127.0.0.1:1');
  });

  it('falls back to the error message on one line', () => {
    expect(cliErrorMessage(new Error('Unexpected end of JSON input\n  at x'))).toBe('Unexpected end of JSON input at x');
    expect(cliErrorMessage(new Error('boom', { cause: 'not an error' }))).toBe('boom');
    expect(cliErrorMessage('plain')).toBe('plain');
  });
});

describe('cliServiceErrorHandler', () => {
  it('writes the reason as the last stderr line and fails the process', () => {
    const stderr = captureStderr();
    cliServiceErrorHandler(new Error('Failed query\nparams: x', { cause: new Error('password authentication failed') }));
    expect(stderr.join('').trim().split('\n').at(-1)).toBe('password authentication failed');
    expect(process.exitCode).toBe(1);
  });
});

describe('replay-diff CLI with an unreachable database', () => {
  it('exits 1 with the pg error as the last stderr line and prints no JSON', async () => {
    const stderr = captureStderr();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const argv = process.argv;
    process.argv = [process.execPath, 'replay-diff-cli.js', '--day', '2026-10-14'];
    try {
      await CommandFactory.run(ReplayDiffCliModule.forUrl('postgres://cane_replay@127.0.0.1:1/none'), {
        logger: false,
        serviceErrorHandler: cliServiceErrorHandler,
      });
    } finally {
      process.argv = argv;
    }
    expect(process.exitCode).toBe(1);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr.join('').trim().split('\n').at(-1)).toMatch(/ECONNREFUSED/);
  });
});
