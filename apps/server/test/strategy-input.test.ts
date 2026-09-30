import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { parseCreate, parsePatch, validateFields, type StrategyFields } from '../src/strategies/strategy-input.js';

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof BadRequestException) return (e.getResponse() as { code: string }).code;
    throw e;
  }
  throw new Error('expected BadRequestException');
};

describe('parseCreate defaults', () => {
  it('applies the futures defaults', () => {
    expect(parseCreate({ pair: 'btcusdt' })).toEqual({
      pair: 'BTCUSDT',
      market: 'futures',
      leverage: 5,
      sizingMode: 'B',
      marginMode: 'isolated',
      basePct: '10',
      confidenceThreshold: '0.70',
      riskPct: null,
    });
  });

  it('applies the spot defaults (no leverage, no margin mode)', () => {
    const f = parseCreate({ pair: 'ETHUSDT', market: 'spot' });
    expect(f.leverage).toBeNull();
    expect(f.marginMode).toBeNull();
    expect(f.sizingMode).toBe('B');
    expect(f.riskPct).toBeNull();
  });

  it('defaults riskPct to 2 in mode C', () => {
    expect(parseCreate({ pair: 'BTCUSDT', sizingMode: 'C' }).riskPct).toBe('2');
  });

  it('keeps an explicit mode C riskPct', () => {
    expect(parseCreate({ pair: 'BTCUSDT', sizingMode: 'C', riskPct: 1.5 }).riskPct).toBe('1.5');
  });

  it('accepts numbers as strings', () => {
    expect(parseCreate({ pair: 'BTCUSDT', basePct: '12.5' }).basePct).toBe('12.5');
  });
});

describe('parseCreate rejections', () => {
  it('rejects a missing pair', () => {
    expect(codeOf(() => parseCreate({}))).toBe('bad_pair');
  });

  it('rejects a non-USDT pair', () => {
    expect(codeOf(() => parseCreate({ pair: 'BTCBUSD' }))).toBe('bad_pair');
  });

  it('rejects the bare quote asset', () => {
    expect(codeOf(() => parseCreate({ pair: 'USDT' }))).toBe('bad_pair');
  });

  it('rejects an unknown market', () => {
    expect(codeOf(() => parseCreate({ pair: 'BTCUSDT', market: 'margin' }))).toBe('bad_market');
  });

  it('rejects spot with leverage', () => {
    expect(codeOf(() => parseCreate({ pair: 'BTCUSDT', market: 'spot', leverage: 3 }))).toBe('spot_no_leverage');
  });

  it('rejects spot with a margin mode', () => {
    expect(codeOf(() => parseCreate({ pair: 'BTCUSDT', market: 'spot', marginMode: 'cross' }))).toBe('spot_no_leverage');
  });

  it('rejects spot with sizing mode A', () => {
    expect(codeOf(() => parseCreate({ pair: 'BTCUSDT', market: 'spot', sizingMode: 'A' }))).toBe('spot_sizing_mode');
  });

  it.each([0, 21, 2.5, '5'])('rejects futures leverage %s', (leverage) => {
    expect(codeOf(() => parseCreate({ pair: 'BTCUSDT', leverage }))).toBe('bad_leverage');
  });

  it.each([4.99, 20.01])('rejects basePct %s', (basePct) => {
    expect(codeOf(() => parseCreate({ pair: 'BTCUSDT', basePct }))).toBe('bad_basePct');
  });

  it('accepts basePct at the bounds 5 and 20', () => {
    expect(parseCreate({ pair: 'BTCUSDT', basePct: 5 }).basePct).toBe('5');
    expect(parseCreate({ pair: 'BTCUSDT', basePct: 20 }).basePct).toBe('20');
  });

  it.each([-0.01, 1.01])('rejects confidenceThreshold %s', (confidenceThreshold) => {
    expect(codeOf(() => parseCreate({ pair: 'BTCUSDT', confidenceThreshold }))).toBe('bad_confidenceThreshold');
  });

  it('accepts confidenceThreshold at the bounds 0 and 1', () => {
    expect(parseCreate({ pair: 'BTCUSDT', confidenceThreshold: 0 }).confidenceThreshold).toBe('0');
    expect(parseCreate({ pair: 'BTCUSDT', confidenceThreshold: 1 }).confidenceThreshold).toBe('1');
  });

  it('rejects riskPct on sizing mode B', () => {
    expect(codeOf(() => parseCreate({ pair: 'BTCUSDT', riskPct: 2 }))).toBe('risk_pct_mode_c_only');
  });

  it('rejects mode C riskPct of 0', () => {
    expect(codeOf(() => parseCreate({ pair: 'BTCUSDT', sizingMode: 'C', riskPct: 0 }))).toBe('bad_riskPct');
  });

  it('rejects riskPct above 100', () => {
    expect(codeOf(() => parseCreate({ pair: 'BTCUSDT', sizingMode: 'C', riskPct: 101 }))).toBe('bad_riskPct');
  });

  it('rejects unknown fields', () => {
    expect(codeOf(() => parseCreate({ pair: 'BTCUSDT', status: 'enabled' }))).toBe('unknown_field');
  });

  it('rejects a non-object body', () => {
    expect(codeOf(() => parseCreate(['BTCUSDT']))).toBe('bad_body');
    expect(codeOf(() => parseCreate('BTCUSDT'))).toBe('bad_body');
  });
});

describe('parsePatch', () => {
  it('returns an empty object for an empty body', () => {
    expect(parsePatch({})).toEqual({});
  });

  it('normalises basePct to a decimal string', () => {
    expect(parsePatch({ basePct: 15 })).toEqual({ basePct: '15' });
  });

  it('passes a null marginMode through', () => {
    expect(parsePatch({ marginMode: null })).toEqual({ marginMode: null });
  });

  it('passes a null leverage through', () => {
    expect(parsePatch({ leverage: null })).toEqual({ leverage: null });
  });

  it('upper-cases the pair', () => {
    expect(parsePatch({ pair: 'solusdt' })).toEqual({ pair: 'SOLUSDT' });
  });

  it('rejects a fractional leverage', () => {
    expect(codeOf(() => parsePatch({ leverage: 1.5 }))).toBe('bad_leverage');
  });
});

describe('validateFields', () => {
  const valid: StrategyFields = {
    pair: 'BTCUSDT',
    market: 'futures',
    leverage: 5,
    sizingMode: 'B',
    marginMode: 'isolated',
    basePct: '10',
    confidenceThreshold: '0.70',
    riskPct: null,
  };

  it('returns a valid futures object unchanged', () => {
    expect(validateFields(valid)).toBe(valid);
  });

  it('rejects futures without a margin mode', () => {
    expect(codeOf(() => validateFields({ ...valid, marginMode: null }))).toBe('bad_marginMode');
  });

  it('rejects futures without a leverage', () => {
    expect(codeOf(() => validateFields({ ...valid, leverage: null }))).toBe('bad_leverage');
  });
});
