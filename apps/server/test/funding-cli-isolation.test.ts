import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FundingCliModule } from '../src/cli/funding-cli.module.js';
import { FETCH_FN } from '../src/market-data/klines.client.js';

// Plan F01: funding data is public market data. The funding CLI writes funding_rate
// but can never place orders, read settings or hold keys.
const ALLOWED_MODULES = new Set(['RootTestModule', 'FundingCliModule', 'FundingModule', 'DbModule', 'InternalCoreModule']);
const FORBIDDEN_NAME = /executor|order|place|cancel|trading|secret|api.?key|signature|account|balance|settings|master|credential|notif|engine/i;
const src = fileURLToPath(new URL('../src/', import.meta.url));

describe('funding CLI isolation', () => {
  let container: ModulesContainer;
  let close: () => Promise<void>;
  const savedUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    // The pool connects lazily: nothing reaches this URL during the test.
    process.env.DATABASE_URL = 'postgres://nobody@127.0.0.1:1/none';
    const moduleRef = await Test.createTestingModule({ imports: [FundingCliModule] })
      .overrideProvider(FETCH_FN)
      .useValue(() => Promise.reject(new Error('network disabled in test')))
      .compile();
    container = moduleRef.get(ModulesContainer);
    close = () => moduleRef.close();
  });

  afterAll(async () => {
    await close();
    if (savedUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedUrl;
  });

  it('loads only the funding, DB and CLI modules (no engine, Binance trading or settings)', () => {
    const names = [...container.values()].map((m) => m.metatype.name);
    expect(names.filter((n) => !ALLOWED_MODULES.has(n))).toEqual([]);
  });

  it('has no provider that could place orders or hold keys', () => {
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
    expect(scanned).toEqual(expect.arrayContaining(['FundingClient', 'FundingStore', 'FundingSync', 'FundingBackfillCommand', 'FundingCheckCommand']));
    expect(offenders).toEqual([]);
  });

  it('funding sources call public market-data endpoints only and import nothing from trading', () => {
    const dir = path.join(src, 'funding');
    const files = readdirSync(dir).map((f) => path.join(dir, f));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/process\.env/);
      expect(text, f).not.toMatch(/engine\/|settings\/|binance\/|exchange\//);
      expect(text, f).not.toMatch(/signature|X-MBX-APIKEY|\/fapi\/v\d\/(order|account|balance|positionRisk|leverage)/);
    }
  });
});
