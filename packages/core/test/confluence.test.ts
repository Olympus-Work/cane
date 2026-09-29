import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { confluenceFeatures, FACTOR_NAMES } from '../src/features/confluence.js';
import type { Candle } from '../src/types.js';

const DAY = 86_400_000;
type Bar = { o: number; h: number; l: number; c: number; v?: number };

function series(n: number, base: Bar, overrides: Record<number, Bar>): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const b = overrides[i] ?? base;
    return {
      openTime: i * DAY,
      closeTime: (i + 1) * DAY - 1,
      open: new Decimal(b.o),
      high: new Decimal(b.h),
      low: new Decimal(b.l),
      close: new Decimal(b.c),
      volume: new Decimal(b.v ?? 10),
    };
  });
}

/** Price reflection P -> 200 - P: bearish <-> bullish, gap-down <-> gap-up, same true range. */
function reflect(candles: Candle[]): Candle[] {
  const r = (x: Decimal) => new Decimal(200).minus(x);
  return candles.map((c) => ({ ...c, open: r(c.open), high: r(c.low), low: r(c.high), close: r(c.close) }));
}

const fx = (v: Decimal | null) => (v === null ? null : v.toFixed(6));

describe('channel breakout (long)', () => {
  // Pivot highs at 20 / 32 / 44 (130, 124, 118): exactly on y = 140 - 0.5x.
  const candles = series(60, { o: 95, h: 100, l: 90, c: 95 }, {
    20: { o: 95, h: 130, l: 90, c: 95 },
    32: { o: 95, h: 124, l: 90, c: 95 },
    44: { o: 95, h: 118, l: 90, c: 95 },
    59: { o: 100, h: 116, l: 99, c: 115 },
  });
  const f = confluenceFeatures(candles, 59, 'long');

  it('fits the line through the pivot highs of the last 60 bars', () => {
    expect(f.channel.pivotCount).toBe(3);
    expect(f.channel.touches).toBe(3);
    // slope -0.5 / mean(130, 124, 118) = -0.5 / 124
    expect(fx(f.channel.slopePctPerBar)).toBe('-0.403226');
    // line at 59 = 110.5; (115 - 110.5) / 110.5
    expect(fx(f.channel.closeBeyondPct)).toBe('4.072398');
  });

  it('only pivots inside the 60-bar lookback count', () => {
    const later = series(81, { o: 95, h: 100, l: 90, c: 95 }, {
      20: { o: 95, h: 130, l: 90, c: 95 },
      32: { o: 95, h: 124, l: 90, c: 95 },
      44: { o: 95, h: 118, l: 90, c: 95 },
    });
    // window = bars 21..80 -> pivot at 20 drops out -> 2 pivots, no line
    const c = confluenceFeatures(later, 80, 'long').channel;
    expect(c).toEqual({ pivotCount: 2, slopePctPerBar: null, touches: 0, closeBeyondPct: null });
  });

  it('a pivot needs 5 bars on its right before the signal candle', () => {
    const late = series(60, { o: 95, h: 100, l: 90, c: 95 }, {
      20: { o: 95, h: 130, l: 90, c: 95 },
      32: { o: 95, h: 124, l: 90, c: 95 },
      56: { o: 95, h: 118, l: 90, c: 95 }, // 56 + 5 > 59: not confirmed
    });
    expect(confluenceFeatures(late, 59, 'long').channel.pivotCount).toBe(2);
  });

  it('pivots must be strictly higher than their neighbours', () => {
    const flat = series(60, { o: 95, h: 100, l: 90, c: 95 }, { 20: { o: 95, h: 100, l: 90, c: 95 } });
    expect(confluenceFeatures(flat, 59, 'long').channel.pivotCount).toBe(0);
  });
});

describe('channel breakdown (short, mirrored)', () => {
  // Pivot lows at 20 / 32 / 44 (70, 76, 82): ascending on y = 60 + 0.5x; close 85 breaks below.
  const candles = series(60, { o: 105, h: 110, l: 100, c: 105 }, {
    20: { o: 105, h: 110, l: 70, c: 105 },
    32: { o: 105, h: 110, l: 76, c: 105 },
    44: { o: 105, h: 110, l: 82, c: 105 },
    59: { o: 88, h: 90, l: 84, c: 85 },
  });
  const f = confluenceFeatures(candles, 59, 'short');

  it('fits the line through the pivot lows; close below the line is positive', () => {
    expect(f.channel.pivotCount).toBe(3);
    expect(f.channel.touches).toBe(3);
    // line at 59 = 89.5; (89.5 - 85) / 89.5
    expect(fx(f.channel.closeBeyondPct)).toBe('5.027933');
    // mirrored frame: an ascending lows line reads like a descending highs line (negative)
    expect(fx(f.channel.slopePctPerBar)).toBe('-0.657895');
  });
});

describe('capitulation (long) / euphoria (short)', () => {
  // Calm bars: TR 2 -> ATR(14) = 2. Window = 10 bars before the signal (30..39).
  const calm = { o: 100, h: 101, l: 99, c: 100 };
  const candles = series(41, calm, {
    33: { o: 100, h: 100, l: 96, c: 96 }, // body 4 >= 1.5 x ATR (2.14)
    34: { o: 96, h: 96, l: 92, c: 92 }, // body 4 >= 1.5 x 2.28
    35: { o: 92, h: 92, l: 88, c: 88, v: 50 }, // body 4 >= 1.5 x 2.40, volume spike
    36: { o: 85, h: 87, l: 84, c: 86 }, // gap-down: opens below the previous low 88
    37: { o: 86, h: 87, l: 85, c: 86 },
    38: { o: 86, h: 87, l: 85, c: 86 },
    39: { o: 86, h: 87, l: 85, c: 86 },
    40: { o: 86, h: 91, l: 86, c: 90 }, // signal
  });

  it('longest big bearish run, gap-downs and volume spike in the 10 bars before the signal', () => {
    const e = confluenceFeatures(candles, 40, 'long').exhaustion;
    expect(e.longestBigBodyRun).toBe(3);
    expect(e.gapCount).toBe(1);
    // max volume 50 / average of bars 10..29 (10)
    expect(e.volumeSpike!.toString()).toBe('5');
  });

  it('short mirror: the reflected chart (big bullish bodies, gap-up) gives the same euphoria numbers', () => {
    expect(confluenceFeatures(reflect(candles), 40, 'short').exhaustion).toEqual(
      confluenceFeatures(candles, 40, 'long').exhaustion,
    );
  });

  it('the opposite side does not see capitulation candles as euphoria', () => {
    const e = confluenceFeatures(candles, 40, 'short').exhaustion;
    expect(e.longestBigBodyRun).toBe(0);
    expect(e.gapCount).toBe(0);
  });

  it('volume spike is unavailable without 20 bars before the window', () => {
    expect(confluenceFeatures(candles.slice(0, 25), 24, 'long').exhaustion.volumeSpike).toBeNull();
  });
});

describe('higher low (long) / lower high (short)', () => {
  const base = { o: 105, h: 110, l: 100, c: 105 };
  const candles = series(101, base, {
    30: { o: 105, h: 110, l: 80, c: 105 },
    60: { o: 105, h: 110, l: 88, c: 105 },
    97: { o: 105, h: 110, l: 70, c: 105 }, // not confirmed at signal 100 (needs 5 bars after)
  });

  it('% change between the last two confirmed pivot lows', () => {
    const s = confluenceFeatures(candles, 100, 'long').swing;
    expect(s.changePct!.toString()).toBe('10'); // (88 - 80) / 80
    expect(s.barsApart).toBe(30);
  });

  it('short mirror: lower high on the reflected chart is positive', () => {
    const s = confluenceFeatures(reflect(candles), 100, 'short').swing;
    // reflected pivot highs 120 -> 112: (120 - 112) / 120 = 6.666...%
    expect(fx(s.changePct)).toBe('6.666667');
    expect(s.barsApart).toBe(30);
  });

  it('fewer than two pivots -> unavailable', () => {
    const one = series(101, base, { 60: { o: 105, h: 110, l: 88, c: 105 } });
    expect(confluenceFeatures(one, 100, 'long').swing).toEqual({ changePct: null, barsApart: null });
  });
});

describe('B8.1 / B8.2 shape', () => {
  it('uses only candles up to and including the signal candle (future bars change nothing)', () => {
    const calm = { o: 100, h: 101, l: 99, c: 100 };
    const a = series(80, calm, { 50: { o: 100, h: 120, l: 99, c: 100 } });
    const b = series(90, calm, { 50: { o: 100, h: 120, l: 99, c: 100 }, 85: { o: 100, h: 300, l: 1, c: 100 } });
    expect(confluenceFeatures(b, 79, 'long')).toEqual(confluenceFeatures(a, 79, 'long'));
  });

  it('carries only side, timeframe, candle time and market-derived numbers', () => {
    const f = confluenceFeatures(series(60, { o: 1, h: 2, l: 1, c: 1 }, {}), 59, 'long');
    expect(Object.keys(f).sort()).toEqual(['channel', 'exhaustion', 'side', 'signalOpenTime', 'swing', 'timeframe']);
    expect(FACTOR_NAMES.short).toEqual(['channel_breakdown', 'euphoria', 'lower_high']);
  });

  it('rejects a signal index outside the candles', () => {
    expect(() => confluenceFeatures([], 0, 'long')).toThrow();
  });
});
