import { describe, expect, it } from 'vitest';
import {
  bangkokDay,
  fmtClock,
  fmtDateTime,
  fmtMoney,
  fmtPct,
  fmtPrice,
  fmtQty,
  pnlDir,
  signed,
} from '../src/lib/format.js';

describe('fmtMoney', () => {
  it('formats with grouping and fixed decimals', () => {
    expect(fmtMoney('10000')).toBe('10,000.00');
    expect(fmtMoney('4120.555')).toBe('4,120.56');
    expect(fmtMoney('-5.5')).toBe('-5.50');
  });

  it('returns an em dash for null', () => {
    expect(fmtMoney(null)).toBe('—');
  });

  it('rounds half-up', () => {
    expect(fmtMoney('0.005')).toBe('0.01');
    expect(fmtMoney('1.0049', 2)).toBe('1.00');
    expect(fmtMoney('2.675')).toBe('2.68');
  });

  it('honours the dp parameter', () => {
    expect(fmtMoney('1.2345', 0)).toBe('1');
    expect(fmtMoney('1.2345', 4)).toBe('1.2345');
  });
});

describe('fmtPrice', () => {
  it('picks decimals by magnitude', () => {
    expect(fmtPrice('61240')).toBe('61,240.00');
    expect(fmtPrice('2.5')).toBe('2.500');
    expect(fmtPrice('0.5')).toBe('0.5000');
  });

  it('returns an em dash for null', () => {
    expect(fmtPrice(null)).toBe('—');
  });

  it('uses the absolute value for the magnitude', () => {
    expect(fmtPrice('-0.5')).toBe('-0.5000');
    expect(fmtPrice('-100')).toBe('-100.00');
  });
});

describe('fmtQty', () => {
  it('shows at least 3 decimals for short fractions', () => {
    expect(fmtQty('0.05')).toBe('0.050');
    expect(fmtQty('0.0512')).toBe('0.0512');
    expect(fmtQty('2')).toBe('2');
  });

  it('returns an em dash for null', () => {
    expect(fmtQty(null)).toBe('—');
  });

  it('drops trailing zeros but keeps up to 8 decimals, rounding half-up', () => {
    expect(fmtQty('1.500000')).toBe('1.500');
    expect(fmtQty('0.000000005')).toBe('0.00000001');
    expect(fmtQty('0.123456785')).toBe('0.12345679');
  });

  it('groups the integer part', () => {
    expect(fmtQty('1234567.89')).toBe('1,234,567.890');
  });
});

describe('signed', () => {
  it('adds a plus sign to positive values', () => {
    expect(signed('312.45')).toBe('+312.45');
    expect(signed('10000')).toBe('+10,000.00');
  });

  it('uses U+2212 (not a hyphen) for negative values', () => {
    expect(signed('-1284.9')).toBe('−1,284.90');
    expect(signed('-1284.9').charCodeAt(0)).toBe(0x2212);
  });

  it('shows no sign for zero after rounding', () => {
    expect(signed('0.001')).toBe('0.00');
    expect(signed('-0.001')).toBe('0.00');
    expect(signed('0')).toBe('0.00');
  });
});

describe('pnlDir', () => {
  it('classifies positive, negative and zero', () => {
    expect(pnlDir('1')).toBe('up');
    expect(pnlDir('-1')).toBe('down');
    expect(pnlDir('0')).toBe('flat');
  });

  it('returns flat for null', () => {
    expect(pnlDir(null)).toBe('flat');
  });

  it('compares the exact value, not the rounded one', () => {
    expect(pnlDir('0.001')).toBe('up');
    expect(pnlDir('-0.001')).toBe('down');
  });
});

describe('fmtPct', () => {
  it('appends a percent sign to the signed value', () => {
    expect(fmtPct('1.5')).toBe('+1.50%');
    expect(fmtPct('-0.2')).toBe('−0.20%');
  });

  it('shows no sign for zero', () => {
    expect(fmtPct('0')).toBe('0.00%');
    expect(fmtPct('0.001')).toBe('0.00%');
  });

  it('returns an em dash for null', () => {
    expect(fmtPct(null)).toBe('—');
  });
});

describe('bangkokDay', () => {
  it('converts to the Bangkok calendar day', () => {
    expect(bangkokDay('2026-09-26T18:00:00.000Z')).toBe('2026-09-27');
    expect(bangkokDay('2026-09-26T00:00:00.000Z')).toBe('2026-09-26');
  });

  it('handles the 17:00 UTC day boundary', () => {
    expect(bangkokDay('2026-09-26T16:59:59.000Z')).toBe('2026-09-26');
    expect(bangkokDay('2026-09-26T17:00:00.000Z')).toBe('2026-09-27');
  });
});

describe('fmtDateTime', () => {
  it('formats as YYYY-MM-DD HH:mm in Bangkok time', () => {
    expect(fmtDateTime('2026-09-26T18:05:00.000Z')).toBe('2026-09-27 01:05');
    expect(fmtDateTime('2026-09-26T16:59:59.000Z')).toBe('2026-09-26 23:59');
  });

  it('keeps midnight as 00', () => {
    expect(fmtDateTime('2026-09-25T17:00:00.000Z')).toBe('2026-09-26 00:00');
  });
});

describe('fmtClock', () => {
  it('formats as HH:mm:ss in Bangkok time', () => {
    expect(fmtClock('2026-09-26T18:05:03.000Z')).toBe('01:05:03');
    expect(fmtClock('2026-09-26T09:00:00.000Z')).toBe('16:00:00');
  });

  it('shows midnight as 00:00:00, not 24:00:00', () => {
    expect(fmtClock('2026-09-25T17:00:00.000Z')).toBe('00:00:00');
  });
});
