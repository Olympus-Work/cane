import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReplayCliModule } from '../src/cli/replay-cli.module.js';
import { FETCH_FN } from '../src/market-data/klines.client.js';

// Plan S01: the replay context must not be able to place orders, even with a bug.
const ALLOWED_MODULES = new Set(['RootTestModule', 'ReplayCliModule', 'ReplayModule', 'MarketDataModule', 'InternalCoreModule']);
const FORBIDDEN_NAME = /order|trade|executor|binance(?!.*kline)|secret|api.?key|signature|account|balance|position/i;

describe('replay isolation', () => {
  let container: ModulesContainer;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ReplayCliModule] })
      .overrideProvider(FETCH_FN)
      .useValue(() => Promise.reject(new Error('network disabled in test')))
      .compile();
    container = moduleRef.get(ModulesContainer);
    close = () => moduleRef.close();
  });

  afterAll(async () => {
    await close();
  });

  it('loads only the replay, market-data and CLI modules', () => {
    const names = [...container.values()].map((m) => m.metatype.name);
    expect(names.filter((n) => !ALLOWED_MODULES.has(n))).toEqual([]);
  });

  it('has no provider that could place orders or hold keys', () => {
    const offenders: string[] = [];
    const scanned: string[] = [];
    for (const mod of container.values()) {
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
    expect(scanned).toEqual(expect.arrayContaining(['ReplayService', 'KlinesClient', 'KlineCache', 'ReplayCommand']));
    expect(offenders).toEqual([]);
  });

  it('replay, market-data and CLI sources never read env, send API-key headers or sign requests', () => {
    const src = fileURLToPath(new URL('../src/', import.meta.url));
    const dirs = ['replay', 'market-data', 'cli'].map((d) => path.join(src, d));
    const files = dirs.flatMap(function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((f) => {
        const p = path.join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
      });
    });
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/process\.env/);
      expect(text, f).not.toMatch(/X-MBX-APIKEY/i);
      expect(text, f).not.toMatch(/createHmac|signature=/);
      expect(text, f).not.toMatch(/\/(fapi|api)\/v\d\/(order|openOrders|allOrders|account|algo)/);
    }
  });
});
