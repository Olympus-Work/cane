import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReplayDiffCliModule } from '../src/cli/replay-diff-cli.module.js';
import { FETCH_FN } from '../src/market-data/klines.client.js';

// Plan S13: the replay-diff context reads live records but can never place orders or write.
const ALLOWED_MODULES = new Set(['RootTestModule', 'ReplayDiffCliModule', 'ReplayDiffModule', 'MarketDataModule', 'InternalCoreModule']);
const FORBIDDEN_NAME = /executor|place|cancel|binance(?!.*kline)|secret|api.?key|signature|account|balance|settings|master|credential|notif|insert|update|delete|claim|annotate/i;
const src = fileURLToPath(new URL('../src/', import.meta.url));

describe('replay-diff isolation', () => {
  let container: ModulesContainer;
  let close: () => Promise<void>;

  beforeAll(async () => {
    // The pool connects lazily: nothing reaches this URL during the test.
    const moduleRef = await Test.createTestingModule({ imports: [ReplayDiffCliModule.forUrl('postgres://cane_replay@127.0.0.1:1/none')] })
      .overrideProvider(FETCH_FN)
      .useValue(() => Promise.reject(new Error('network disabled in test')))
      .compile();
    container = moduleRef.get(ModulesContainer);
    close = () => moduleRef.close();
  });

  afterAll(async () => {
    await close();
  });

  it('loads only the replay-diff, market-data and CLI modules (no DbModule, engine or settings)', () => {
    const names = [...container.values()].map((m) => m.metatype.name);
    expect(names.filter((n) => !ALLOWED_MODULES.has(n))).toEqual([]);
  });

  it('has no provider that could place orders, write records or hold keys', () => {
    const offenders: string[] = [];
    const scanned: string[] = [];
    for (const mod of container.values()) {
      if (mod.metatype.name === 'InternalCoreModule') continue; // Nest internals (graph, container)
      for (const [token, wrapper] of mod.providers) {
        const tokenName = typeof token === 'function' ? token.name : String(token);
        scanned.push(tokenName);
        if (FORBIDDEN_NAME.test(tokenName)) offenders.push(`token ${tokenName}`);
        const instance = wrapper.instance as object | null | undefined;
        if (!instance || typeof instance !== 'object') continue;
        let proto = Object.getPrototypeOf(instance) as object | null;
        while (proto && proto !== Object.prototype) {
          for (const method of Object.getOwnPropertyNames(proto)) {
            if (FORBIDDEN_NAME.test(method)) offenders.push(`${tokenName}.${method}`);
          }
          proto = Object.getPrototypeOf(proto) as object | null;
        }
      }
    }
    expect(scanned).toEqual(expect.arrayContaining(['ReplayDiffService', 'KlineCache', 'ReplayDiffCommand', 'Symbol(LIVE_RECORDS)']));
    expect(offenders).toEqual([]);
  });

  it('replay-diff sources never read env, import the server DB module or write', () => {
    const dir = path.join(src, 'replay-diff');
    const files = readdirSync(dir).map((f) => path.join(dir, f));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/process\.env/);
      expect(text, f).not.toMatch(/db\.module|engine\/|settings\/|binance\//);
      expect(text, f).not.toMatch(/\.(insert|update|delete)\(/);
    }
  });

  it('the CLI entry reads REPLAY_DATABASE_URL only, with no fallback to DATABASE_URL', () => {
    const text = readFileSync(path.join(src, 'replay-diff-cli.ts'), 'utf8');
    expect([...text.matchAll(/process\.env\.(\w+)/g)].map((m) => m[1])).toEqual(['REPLAY_DATABASE_URL']);
  });
});
