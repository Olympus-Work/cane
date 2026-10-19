import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FundingBacktestCliModule } from '../src/cli/funding-backtest-cli.module.js';
import { FETCH_FN } from '../src/market-data/klines.client.js';

// Plan F02: the backtest reads funding_rate and public klines but can never place orders or write.
const ALLOWED_MODULES = new Set(['RootTestModule', 'FundingBacktestCliModule', 'FundingBacktestModule', 'MarketDataModule', 'InternalCoreModule']);
const FORBIDDEN_NAME = /executor|order|place|cancel|trading|binance(?!.*kline)|secret|api.?key|signature|account|balance|settings|master|credential|notif|engine|insert|upsert|update|delete|sync/i;
const src = fileURLToPath(new URL('../src/', import.meta.url));

describe('funding backtest isolation', () => {
  let container: ModulesContainer;
  let close: () => Promise<void>;

  beforeAll(async () => {
    // The pool connects lazily: nothing reaches this URL during the test.
    const moduleRef = await Test.createTestingModule({ imports: [FundingBacktestCliModule.forUrl('postgres://cane_replay@127.0.0.1:1/none')] })
      .overrideProvider(FETCH_FN)
      .useValue(() => Promise.reject(new Error('network disabled in test')))
      .compile();
    container = moduleRef.get(ModulesContainer);
    close = () => moduleRef.close();
  });

  afterAll(async () => {
    await close();
  });

  it('loads only the backtest, market-data and CLI modules (no DbModule, engine or settings)', () => {
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
    expect(scanned).toEqual(expect.arrayContaining(['FundingBacktestService', 'KlineCache', 'FundingBacktestCommand', 'Symbol(BACKTEST_FUNDING)']));
    expect(offenders).toEqual([]);
  });

  it('backtest sources never read env, import the server DB module or write', () => {
    const dir = path.join(src, 'funding-backtest');
    const files = readdirSync(dir).map((f) => path.join(dir, f));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/process\.env/);
      expect(text, f).not.toMatch(/db\.module|engine\/|settings\/|binance\/|exchange\/|funding\.sync|funding\.client/);
      expect(text, f).not.toMatch(/\.(insert|upsert|update|delete)\(/);
    }
  });

  it('the CLI entry reads REPLAY_DATABASE_URL only, with no fallback to DATABASE_URL', () => {
    const text = readFileSync(path.join(src, 'funding-backtest-cli.ts'), 'utf8');
    expect([...text.matchAll(/process\.env\.(\w+)/g)].map((m) => m[1])).toEqual(['REPLAY_DATABASE_URL']);
  });
});
