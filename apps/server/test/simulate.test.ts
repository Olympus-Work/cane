import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { TIMEFRAME_MS, type Candle, type Decision, type DecideInput } from '@cane/core';
import { simulate } from '../src/replay/simulate.js';

const H4 = TIMEFRAME_MS['4h'];
const DAY = TIMEFRAME_MS['1d'];
const WEEK = TIMEFRAME_MS['1w'];
// Binance weeks open Monday 00:00 UTC; 1970-01-05 was a Monday.
const START = 4 * DAY;

/** Deterministic wavy 4H path (several regimes on every timeframe). */
function path4h(n: number): Candle[] {
  const out: Candle[] = [];
  let prev = new Decimal(100);
  for (let i = 0; i < n; i++) {
    const t = i / 6; // days
    const level = 100 + 40 * Math.sin(t / 90) + 15 * Math.sin(t / 17) + 5 * Math.sin(t / 3.1);
    const close = new Decimal(level.toFixed(2));
    const hi = Decimal.max(prev, close).plus(0.8);
    const lo = Decimal.min(prev, close).minus(0.8);
    out.push({ openTime: START + i * H4, closeTime: START + (i + 1) * H4 - 1, open: prev, high: hi, low: lo, close, volume: new Decimal(1) });
    prev = close;
  }
  return out;
}

function aggregate(src: readonly Candle[], dur: number): Candle[] {
  const out: Candle[] = [];
  for (const c of src) {
    const openTime = START + Math.floor((c.openTime - START) / dur) * dur;
    const last = out.at(-1);
    if (last && last.openTime === openTime) {
      out[out.length - 1] = { ...last, high: Decimal.max(last.high, c.high), low: Decimal.min(last.low, c.low), close: c.close };
    } else {
      out.push({ ...c, openTime, closeTime: openTime + dur - 1 });
    }
  }
  // drop an incomplete last bucket
  return out.filter((c) => c.closeTime <= src.at(-1)!.closeTime);
}

const h4 = path4h(6 * 7 * 320); // 320 weeks
const candles = { '4h': h4, '1d': aggregate(h4, DAY), '1w': aggregate(h4, WEEK) };
const to = h4.at(-1)!.closeTime + 1;
const from = to - 2 * 365 * DAY;

describe('simulate (replay)', () => {
  const futures = simulate({ pair: 'TESTUSDT', market: 'futures', candles, from, to });
  const spot = simulate({ pair: 'TESTUSDT', market: 'spot', candles, from, to });

  it('evaluates every 4H close in the window', () => {
    expect(futures.evaluations).toBe(h4.filter((c) => c.closeTime >= from && c.closeTime < to).length);
  });

  it('produces trades on both sides for futures, long only for spot', () => {
    expect(futures.trades.length).toBeGreaterThan(0);
    expect(new Set(futures.trades.map((t) => t.side)).size).toBe(2);
    expect(spot.trades.every((t) => t.side === 'long')).toBe(true);
  });

  it('every trade starts with a protective stop and the stop never widens', () => {
    for (const t of [...futures.trades, ...spot.trades]) {
      if (t.side === 'long') {
        expect(t.initialStop.lt(t.entryPrice)).toBe(true);
        expect(t.finalStop.gte(t.initialStop)).toBe(true);
      } else {
        expect(t.initialStop.gt(t.entryPrice)).toBe(true);
        expect(t.finalStop.lte(t.initialStop)).toBe(true);
      }
    }
  });

  it('positions never overlap and each signal candle is used once', () => {
    const trades = futures.trades;
    for (let i = 1; i < trades.length; i++) {
      expect(trades[i]!.entryTime).toBeGreaterThanOrEqual(trades[i - 1]!.exitTime!);
    }
    const keys = trades.map((t) => `${t.signalTimeframe}:${t.signalOpenTime}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('B7.4: the 1D candle that closed a position never opens the next one', () => {
    let checked = 0;
    for (const r of [futures, spot]) {
      for (let i = 1; i < r.trades.length; i++) {
        const prev = r.trades[i - 1]!;
        const next = r.trades[i]!;
        if (prev.exitReason !== 'first_red' && prev.exitReason !== 'first_green') continue;
        checked++;
        if (next.signalTimeframe === '1d') expect(next.signalOpenTime).toBeGreaterThan(prev.exitTime! - DAY);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('late entries carry a 2R take-profit; primary entries none', () => {
    for (const t of futures.trades) {
      if (t.kind === 'primary') expect(t.takeProfit).toBeNull();
      else {
        const r = t.entryPrice.minus(t.initialStop).abs();
        const expected = t.side === 'long' ? t.entryPrice.plus(r.times(2)) : t.entryPrice.minus(r.times(2));
        expect(t.takeProfit!.eq(expected)).toBe(true);
      }
    }
  });

  it('exit reasons match the side', () => {
    for (const t of futures.trades) {
      if (t.side === 'long') expect(t.exitReason).not.toBe('first_green');
      else expect(t.exitReason).not.toBe('first_red');
    }
  });

  it('is deterministic', () => {
    expect(simulate({ pair: 'TESTUSDT', market: 'futures', candles, from, to })).toEqual(futures);
  });
});

describe('simulate: exit candle is consumed (B7.4)', () => {
  it('a plain entry on the candle that just closed the position is ignored', () => {
    const t0 = to - 30 * DAY;
    const dayOf = (ms: number) => START + Math.floor((ms - START) / DAY) * DAY;
    const exitDay = dayOf(t0 + 5 * DAY) - DAY; // 1D candle X that closes at the exit evaluation
    const px = new Decimal(100);
    // Stub decide: enter long, exit on X, then (like the real decide 4h later) offer a short keyed to X.
    const stub = (inp: DecideInput): Decision => {
      if (inp.nowMs === t0) {
        return { type: 'enter', side: 'long', kind: 'primary', signal: { timeframe: '1d', openTime: dayOf(t0) - DAY }, refPrice: px, stop: new Decimal(1), stopSource: 'trail', takeProfit: null, trend1w: 'bullish' };
      }
      if (inp.position !== null && inp.nowMs === exitDay + DAY) {
        return { type: 'exit', side: 'long', reason: 'first_red', signal: { timeframe: '1d', openTime: exitDay }, refPrice: px };
      }
      if (inp.position === null && inp.nowMs > exitDay + DAY) {
        return { type: 'enter', side: 'short', kind: 'primary', signal: { timeframe: '1d', openTime: exitDay }, refPrice: px, stop: new Decimal(1000), stopSource: 'trail', takeProfit: null, trend1w: 'bearish' };
      }
      return { type: 'none', reason: 'no_signal' };
    };
    const flat = h4.map((c) => ({ ...c, open: px, high: px, low: px, close: px }));
    const r = simulate({ pair: 'TESTUSDT', market: 'futures', candles: { ...candles, '4h': flat }, from: t0 - H4 + 1, to }, stub);
    expect(r.trades.map((t) => [t.side, t.exitReason])).toEqual([['long', 'first_red']]);
  });
});
