import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseFuturesSymbol,
  parseLeverageBrackets,
  parseSpotSymbol,
} from '../src/binance/exchange-info.js';

function loadFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/binance/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

const spotInfo = loadFixture('spot-exchange-info-btcusdt');
const futuresInfo = loadFixture('futures-exchange-info-btc-eth');
const brackets = loadFixture('futures-leverage-bracket-btcusdt');

describe('parseSpotSymbol', () => {
  it('parses spot BTCUSDT filters', () => {
    const info = parseSpotSymbol(spotInfo, 'BTCUSDT');
    expect(info.symbol).toBe('BTCUSDT');
    expect(info.status).toBe('TRADING');
    expect(info.filters.tickSize.toString()).toBe('0.01');
    // MARKET_LOT_SIZE stepSize is zero and is ignored.
    expect(info.filters.stepSize.toString()).toBe('0.00001');
    expect(info.filters.minQty.toString()).toBe('0.00001');
    expect(info.filters.minNotional.toString()).toBe('5');
  });
});

describe('parseFuturesSymbol', () => {
  it('parses futures BTCUSDT filters', () => {
    const info = parseFuturesSymbol(futuresInfo, 'BTCUSDT');
    expect(info.status).toBe('TRADING');
    expect(info.filters.tickSize.toString()).toBe('0.1');
    expect(info.filters.stepSize.toString()).toBe('0.0001');
    expect(info.filters.minQty.toString()).toBe('0.0001');
    expect(info.filters.minNotional.toString()).toBe('50');
  });

  it('parses futures ETHUSDT filters', () => {
    const info = parseFuturesSymbol(futuresInfo, 'ETHUSDT');
    expect(info.filters.tickSize.toString()).toBe('0.01');
    expect(info.filters.stepSize.toString()).toBe('0.001');
    expect(info.filters.minQty.toString()).toBe('0.001');
    expect(info.filters.minNotional.toString()).toBe('20');
  });

  it('lets a coarser MARKET_LOT_SIZE win over LOT_SIZE', () => {
    const body = structuredClone(futuresInfo);
    const btc = (body as { symbols: Array<{ filters: Array<Record<string, unknown>> }> }).symbols[0];
    const marketLot = btc!.filters.find((f) => f.filterType === 'MARKET_LOT_SIZE');
    marketLot!.stepSize = '0.001';
    marketLot!.minQty = '0.002';
    const info = parseFuturesSymbol(body, 'BTCUSDT');
    expect(info.filters.stepSize.toString()).toBe('0.001');
    expect(info.filters.minQty.toString()).toBe('0.002');
  });
});

describe('exchangeInfo validation', () => {
  it('throws for an unknown symbol', () => {
    expect(() => parseFuturesSymbol(futuresInfo, 'DOGEUSDT')).toThrow(/Symbol not found/);
  });

  it('throws for a body without a symbols array', () => {
    expect(() => parseSpotSymbol(null, 'BTCUSDT')).toThrow(/Invalid exchangeInfo/);
  });

  it('throws when PRICE_FILTER is missing', () => {
    const body = structuredClone(futuresInfo);
    const btc = (body as { symbols: Array<{ filters: unknown[] }> }).symbols[0];
    btc!.filters = btc!.filters.filter((f) => (f as { filterType: string }).filterType !== 'PRICE_FILTER');
    expect(() => parseFuturesSymbol(body, 'BTCUSDT')).toThrow(/PRICE_FILTER/);
  });

  it('throws when tickSize is zero', () => {
    const body = structuredClone(futuresInfo);
    const btc = (body as { symbols: Array<{ filters: Array<Record<string, unknown>> }> }).symbols[0];
    const priceFilter = btc!.filters.find((f) => f.filterType === 'PRICE_FILTER');
    priceFilter!.tickSize = '0';
    expect(() => parseFuturesSymbol(body, 'BTCUSDT')).toThrow(/PRICE_FILTER\.tickSize/);
  });
});

describe('parseLeverageBrackets', () => {
  it('parses BTCUSDT brackets sorted by notionalFloor', () => {
    const result = parseLeverageBrackets(brackets, 'BTCUSDT');
    expect(result).toHaveLength(10);
    expect(result[0]!.notionalFloor.toString()).toBe('0');
    expect(result[0]!.notionalCap.toString()).toBe('50000');
    expect(result[0]!.maintMarginRatio.toString()).toBe('0.004');
    expect(result[0]!.cum.toString()).toBe('0');
    expect(result[0]!.maxLeverage).toBe(125);

    expect(result[1]!.notionalFloor.toString()).toBe('50000');
    expect(result[1]!.notionalCap.toString()).toBe('250000');
    expect(result[1]!.maintMarginRatio.toString()).toBe('0.005');
    expect(result[1]!.cum.toString()).toBe('50');
    expect(result[1]!.maxLeverage).toBe(100);

    const last = result[9]!;
    expect(last.maxLeverage).toBe(1);
    expect(last.maintMarginRatio.toString()).toBe('0.5');
    expect(last.cum.toString()).toBe('103046300');

    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.notionalFloor.gte(result[i - 1]!.notionalFloor)).toBe(true);
    }
  });

  it('throws for an unknown symbol', () => {
    expect(() => parseLeverageBrackets(brackets, 'ETHUSDT')).toThrow(
      /Symbol not found in leverageBracket/,
    );
  });
});
