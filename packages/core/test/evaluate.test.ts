import { describe, expect, it } from 'vitest';
import type { ActionZoneBar } from '../src/indicators/cdc-action-zone.js';
import type { TimeframeAnalysis } from '../src/signals/analyze.js';
import {
  decide,
  evaluate,
  signalKey,
  WARMUP_CANDLES,
  type Analyses,
  type Decision,
  type OpenPosition,
  type StrategyInput,
} from '../src/signals/evaluate.js';
import { TIMEFRAME_MS, type Regime, type Timeframe } from '../src/types.js';
import { candle, d, fromCloses } from './helpers.js';

const DAY = TIMEFRAME_MS['1d'];
const START = 0;
// Evaluation right after the 1D candle #N closed (closeTime = open + dur - 1 < now).
const N = 300;
const NOW = START + N * DAY;

const quiet: ActionZoneBar = {
  fast: null, slow: null, bull: false, bear: false, green: false, red: false,
  buyCond: false, sellCond: false, regime: null, firstGreen: false, firstRed: false,
};

interface LastBar {
  zone?: Partial<ActionZoneBar>;
  close?: number;
  trail?: number | null;
  atr?: number | null;
}

/**
 * Hand-made analysis: `count` candles ending exactly at NOW for the timeframe,
 * every bar has `regime`, the last closed bar gets `last`. Indicators are set
 * directly so decision logic is tested apart from the formulas.
 */
function fake(tf: Timeframe, regime: Regime, last: LastBar = {}, count = N, extraOpen?: LastBar): TimeframeAnalysis {
  const dur = TIMEFRAME_MS[tf];
  const first = NOW / dur - count;
  const candles = [];
  const zone: ActionZoneBar[] = [];
  const trail = [];
  const atr = [];
  const total = count + (extraOpen ? 1 : 0);
  for (let k = 0; k < total; k++) {
    const isLast = k === count - 1;
    const isOpen = k === count;
    const spec = isOpen ? extraOpen! : isLast ? last : {};
    const c = spec.close ?? 100;
    candles.push(candle(first + k, { h: c, l: c, c }, tf, START));
    zone.push({ ...quiet, regime, ...(spec.zone ?? {}) });
    trail.push(spec.trail === undefined ? d(90) : spec.trail === null ? null : d(spec.trail));
    atr.push(spec.atr === undefined ? d(5) : spec.atr === null ? null : d(spec.atr));
  }
  return { timeframe: tf, candles, zone, trail, atr };
}

function analyses(parts: Partial<Analyses> = {}): Analyses {
  return {
    '4h': parts['4h'] ?? fake('4h', 'bullish', {}, N * 6),
    '1d': parts['1d'] ?? fake('1d', 'bullish'),
    '1w': parts['1w'] ?? fake('1w', 'bullish', {}, 250),
  };
}

const futures: StrategyInput = { id: 'S-01', market: 'futures' };
const spot: StrategyInput = { id: 'S-02', market: 'spot' };
const run = (a: Analyses, position: OpenPosition | null = null, strategy = futures, nowMs = NOW): Decision =>
  decide({ strategy, analyses: a, position, nowMs });

const firstGreen1d = (last: LastBar = {}) => fake('1d', 'bullish', { ...last, zone: { firstGreen: true, buyCond: true, green: true, ...last.zone } });
const firstRed1d = (last: LastBar = {}) => fake('1d', 'bearish', { ...last, zone: { firstRed: true, sellCond: true, red: true, ...last.zone } });

describe('B1 closed candles, warm-up, idempotency', () => {
  it('AC4: a first green on a still-open candle produces no decision', () => {
    const open1d = fake('1d', 'bullish', {}, N, { zone: { firstGreen: true, buyCond: true, green: true, regime: 'bullish' } });
    // The extra candle opens at NOW and closes at NOW + DAY - 1: still open at NOW.
    expect(open1d.candles.at(-1)!.closeTime).toBeGreaterThanOrEqual(NOW);
    expect(run(analyses({ '1d': open1d }))).toEqual({ type: 'none', reason: 'no_signal' });
  });

  it('AC4: the same candle is used once it has closed', () => {
    const open1d = fake('1d', 'bullish', {}, N, { zone: { firstGreen: true, buyCond: true, green: true, regime: 'bullish' } });
    const later = run(analyses({ '1d': open1d }), null, futures, NOW + DAY);
    expect(later.type).toBe('enter');
  });

  it(`B1.3: fewer than ${WARMUP_CANDLES} closed 1D candles -> warming_up`, () => {
    const short1d = fake('1d', 'bullish', { zone: { firstGreen: true } }, WARMUP_CANDLES - 1);
    expect(run(analyses({ '1d': short1d }))).toEqual({ type: 'warming_up', timeframes: ['1d'] });
  });

  it(`B1.3: exactly ${WARMUP_CANDLES} closed candles is enough`, () => {
    const a = analyses({ '1d': fake('1d', 'bullish', { close: 100, zone: { firstGreen: true } }, WARMUP_CANDLES) });
    expect(run(a).type).toBe('enter');
  });

  it('B1.3: 1W warm-up also gates entries', () => {
    expect(run(analyses({ '1d': firstGreen1d(), '1w': fake('1w', 'bullish', {}, 150) }))).toEqual({
      type: 'warming_up',
      timeframes: ['1w'],
    });
  });

  it('B1.2: signal key is strategy + timeframe + candle open time', () => {
    expect(signalKey('S-01', { timeframe: '1d', openTime: 1_700_000_000_000 })).toBe('S-01:1d:1700000000000');
  });

  it('is deterministic: same input -> same decision', () => {
    const a = analyses({ '1d': firstGreen1d() });
    expect(run(a)).toEqual(run(a));
  });
});

describe('B2 1W trend filter + B3 primary entry', () => {
  it('long on 1D first green when 1W is bullish; stop = 1D trail', () => {
    const dec = run(analyses({ '1d': firstGreen1d({ close: 100, trail: 92 }) }));
    expect(dec).toMatchObject({ type: 'enter', side: 'long', kind: 'primary', stopSource: 'trail', takeProfit: null, trend1w: 'bullish' });
    if (dec.type !== 'enter') throw new Error('expected enter');
    expect(dec.stop.toString()).toBe('92');
    expect(dec.refPrice.toString()).toBe('100');
    expect(dec.signal).toEqual({ timeframe: '1d', openTime: (N - 1) * DAY });
  });

  it('no long when 1W is bearish (filter gates entries)', () => {
    const a = analyses({ '1d': firstGreen1d(), '1w': fake('1w', 'bearish', {}, 250) });
    expect(run(a)).toEqual({ type: 'none', reason: 'trend_filter' });
  });

  it('no long when 1W regime is undefined', () => {
    const a = analyses({ '1d': firstGreen1d(), '1w': fake('1w', null, {}, 250) });
    expect(run(a)).toEqual({ type: 'none', reason: 'trend_filter' });
  });

  it('short on 1D first red when 1W is bearish (futures); stop = 1D trail above price', () => {
    const a = analyses({ '1d': firstRed1d({ close: 100, trail: 108 }), '1w': fake('1w', 'bearish', {}, 250) });
    const dec = run(a);
    expect(dec).toMatchObject({ type: 'enter', side: 'short', kind: 'primary', stopSource: 'trail' });
    if (dec.type !== 'enter') throw new Error('expected enter');
    expect(dec.stop.toString()).toBe('108');
  });

  it('B3.3: spot ignores first red', () => {
    const a = analyses({ '1d': firstRed1d(), '1w': fake('1w', 'bearish', {}, 250) });
    expect(run(a, null, spot)).toEqual({ type: 'none', reason: 'spot_ignores_short' });
  });

  it('spot takes first green longs', () => {
    expect(run(analyses({ '1d': firstGreen1d() }), null, spot)).toMatchObject({ type: 'enter', side: 'long' });
  });

  it('B5.2 / E6: trail on the wrong side -> stop = close - 2*ATR(10) (long)', () => {
    const dec = run(analyses({ '1d': firstGreen1d({ close: 100, trail: 104, atr: 3 }) }));
    expect(dec).toMatchObject({ type: 'enter', stopSource: 'atr_fallback' });
    if (dec.type !== 'enter') throw new Error('expected enter');
    expect(dec.stop.toString()).toBe('94');
  });

  it('B5.2 / E6: trail on the wrong side -> stop = close + 2*ATR(10) (short)', () => {
    const a = analyses({ '1d': firstRed1d({ close: 100, trail: 97, atr: 3 }), '1w': fake('1w', 'bearish', {}, 250) });
    const dec = run(a);
    if (dec.type !== 'enter') throw new Error('expected enter');
    expect(dec.stop.toString()).toBe('106');
    expect(dec.stopSource).toBe('atr_fallback');
  });

  it('trail missing and ATR missing -> no entry (invalid_stop)', () => {
    expect(run(analyses({ '1d': firstGreen1d({ trail: null, atr: null }) }))).toEqual({ type: 'none', reason: 'invalid_stop' });
  });
});

describe('B4 late entry (Cane Rule)', () => {
  const late4h = (last: LastBar = {}) =>
    fake('4h', 'bullish', { ...last, zone: { firstGreen: true, buyCond: true, green: true, ...last.zone } }, N * 6);

  it('1D bullish mid-trend (no 1D first green) + 4H first green -> late long, TP = entry + 2R', () => {
    const dec = run(analyses({ '4h': late4h({ close: 100, trail: 96 }) }));
    expect(dec).toMatchObject({ type: 'enter', side: 'long', kind: 'late', stopSource: 'trail' });
    if (dec.type !== 'enter') throw new Error('expected enter');
    expect(dec.stop.toString()).toBe('96');
    expect(dec.takeProfit!.toString()).toBe('108');
    expect(dec.signal.timeframe).toBe('4h');
  });

  it('does not chase on 1D: without a 4H first green there is no entry', () => {
    expect(run(analyses())).toEqual({ type: 'none', reason: 'no_signal' });
  });

  it('4H trail on the wrong side -> stop = close - 2*ATR(10) on 4H, TP from that R', () => {
    const dec = run(analyses({ '4h': late4h({ close: 100, trail: 101, atr: 2 }) }));
    if (dec.type !== 'enter') throw new Error('expected enter');
    expect(dec.stop.toString()).toBe('96');
    expect(dec.takeProfit!.toString()).toBe('108');
    expect(dec.stopSource).toBe('atr_fallback');
  });

  it('late short (futures) mirrors: TP = entry - 2R', () => {
    const a = analyses({
      '1d': fake('1d', 'bearish'),
      '1w': fake('1w', 'bearish', {}, 250),
      '4h': fake('4h', 'bearish', { close: 100, trail: 105, zone: { firstRed: true, sellCond: true, red: true } }, N * 6),
    });
    const dec = run(a);
    expect(dec).toMatchObject({ type: 'enter', side: 'short', kind: 'late' });
    if (dec.type !== 'enter') throw new Error('expected enter');
    expect(dec.takeProfit!.toString()).toBe('90');
  });

  it('late entry needs the 1W filter to agree', () => {
    expect(run(analyses({ '4h': late4h(), '1w': fake('1w', 'bearish', {}, 250) }))).toEqual({ type: 'none', reason: 'trend_filter' });
  });

  it('late entry needs the 1D regime to agree (4H first green while 1D bearish -> nothing)', () => {
    const a = analyses({ '1d': fake('1d', 'bearish'), '4h': late4h() });
    // 1D bearish + 1W bullish: short side blocked by the filter.
    expect(run(a)).toEqual({ type: 'none', reason: 'trend_filter' });
  });

  it('a 1D first green that is the last closed candle is a primary entry, not a late one', () => {
    const dec = run(analyses({ '1d': firstGreen1d(), '4h': late4h() }));
    expect(dec).toMatchObject({ type: 'enter', kind: 'primary', signal: { timeframe: '1d' } });
  });

  it('spot has no late short', () => {
    const a = analyses({
      '1d': fake('1d', 'bearish'),
      '1w': fake('1w', 'bearish', {}, 250),
      '4h': fake('4h', 'bearish', { zone: { firstRed: true } }, N * 6),
    });
    expect(run(a, null, spot)).toEqual({ type: 'none', reason: 'no_signal' });
  });

  it('4H warm-up gates late entries only', () => {
    expect(run(analyses({ '4h': fake('4h', 'bullish', { zone: { firstGreen: true } }, 100) }))).toEqual({
      type: 'warming_up',
      timeframes: ['4h'],
    });
  });
});

describe('B5.3 stop trailing and B7 exits (open position)', () => {
  const long: OpenPosition = { side: 'long', kind: 'primary', stop: d(90), openedAt: NOW - 5 * DAY };
  const short: OpenPosition = { side: 'short', kind: 'primary', stop: d(110), openedAt: NOW - 5 * DAY };

  it('long: first red on the closed 1D candle -> exit', () => {
    const dec = run(analyses({ '1d': fake('1d', 'bearish', { close: 95, zone: { firstRed: true } }) }), long);
    expect(dec).toMatchObject({ type: 'exit', side: 'long', reason: 'first_red' });
  });

  it('short: first green on the closed 1D candle -> exit', () => {
    const dec = run(analyses({ '1d': fake('1d', 'bullish', { zone: { firstGreen: true } }) }), short);
    expect(dec).toMatchObject({ type: 'exit', side: 'short', reason: 'first_green' });
  });

  it('B2.2: the 1W filter never forces an exit', () => {
    const dec = run(analyses({ '1w': fake('1w', 'bearish', {}, 250), '1d': fake('1d', 'bullish', { trail: 90 }) }), long);
    expect(dec).toEqual({ type: 'none', reason: 'no_signal' });
  });

  it('long: stop moves up to the new 1D trail', () => {
    const dec = run(analyses({ '1d': fake('1d', 'bullish', { close: 120, trail: 104 }) }), long);
    expect(dec).toMatchObject({ type: 'move_stop', side: 'long' });
    if (dec.type !== 'move_stop') throw new Error('expected move_stop');
    expect(dec.stop.toString()).toBe('104');
  });

  it('long: stop is never widened', () => {
    expect(run(analyses({ '1d': fake('1d', 'bullish', { close: 120, trail: 85 }) }), long)).toEqual({ type: 'none', reason: 'no_signal' });
  });

  it('long: a trail above price is not used as a stop', () => {
    expect(run(analyses({ '1d': fake('1d', 'bullish', { close: 95, trail: 99 }) }), long)).toEqual({ type: 'none', reason: 'no_signal' });
  });

  it('short: stop moves down only', () => {
    const down = run(analyses({ '1d': fake('1d', 'bearish', { close: 80, trail: 96 }) }), short);
    if (down.type !== 'move_stop') throw new Error('expected move_stop');
    expect(down.stop.toString()).toBe('96');
    expect(run(analyses({ '1d': fake('1d', 'bearish', { close: 80, trail: 115 }) }), short)).toEqual({ type: 'none', reason: 'no_signal' });
  });

  it('B5.3: a late entry is not trailed by the 1D candle that closed before it', () => {
    // Late long opened mid-day (4H) after the last 1D close; that 1D trail (95) is above its 4H stop (90).
    const lateLong: OpenPosition = { side: 'long', kind: 'late', stop: d(90), openedAt: NOW + 8 * 3600_000 };
    const a = analyses({ '1d': fake('1d', 'bullish', { close: 120, trail: 95 }) });
    expect(run(a, lateLong, futures, NOW + 12 * 3600_000)).toEqual({ type: 'none', reason: 'no_signal' });
  });

  it('B5.3: the next 1D close after the entry does trail it', () => {
    const lateLong: OpenPosition = { side: 'long', kind: 'late', stop: d(90), openedAt: NOW - 16 * 3600_000 };
    const dec = run(analyses({ '1d': fake('1d', 'bullish', { close: 120, trail: 95 }) }), lateLong);
    expect(dec).toMatchObject({ type: 'move_stop', side: 'long' });
  });

  it('late-entry positions also exit on the 1D signal', () => {
    const dec = run(analyses({ '1d': fake('1d', 'bearish', { zone: { firstRed: true } }) }), { ...long, kind: 'late' });
    expect(dec).toMatchObject({ type: 'exit', reason: 'first_red' });
  });

  it('a position never produces an entry', () => {
    const dec = run(analyses({ '1d': firstGreen1d({ trail: 80 }) }), long);
    expect(dec.type).not.toBe('enter');
  });
});

describe('E4 market data gap', () => {
  it('stale 1D data (newest candle missing) -> no signal', () => {
    // Last candle closed a full day before NOW + DAY evaluation time.
    const dec = run(analyses({ '1d': firstGreen1d() }), null, futures, NOW + DAY + 1);
    expect(dec).toMatchObject({ type: 'none', reason: 'data_gap' });
  });

  it('missing candle between the last two 1D candles -> no signal', () => {
    const a = firstGreen1d();
    const candles = [...a.candles];
    candles[candles.length - 2] = { ...candles[candles.length - 2]!, openTime: candles[candles.length - 2]!.openTime - DAY };
    expect(run(analyses({ '1d': { ...a, candles } }))).toEqual({ type: 'none', reason: 'data_gap', timeframes: ['1d'] });
  });

  it('gap on 1D blocks position management too', () => {
    const dec = run(analyses({ '1d': fake('1d', 'bearish', { zone: { firstRed: true } }) }), { side: 'long', kind: 'primary', stop: d(90), openedAt: NOW - 5 * DAY }, futures, NOW + 2 * DAY);
    expect(dec).toMatchObject({ type: 'none', reason: 'data_gap' });
  });
});

describe('evaluate() with real indicators', () => {
  it('AC4: an unclosed candle cannot create a first green', () => {
    // Up, down, up, down legs: 1D regime ends bearish. The still-open candle jumps far up.
    const leg = (from: number, n: number, step: number) => Array.from({ length: n }, (_, i) => from + i * step);
    const closes = [...leg(100, 100, 1), ...leg(199, 60, -1), ...leg(140, 70, 1), ...leg(210, 40, -1)];
    const days = fromCloses(closes);
    const now = days.at(-1)!.closeTime + 1;
    const weekCloses = [...leg(100, 150, 1), ...leg(249, 20, -1), ...leg(229, 50, 1)];
    const weeks = fromCloses(weekCloses, '1w', now - weekCloses.length * TIMEFRAME_MS['1w']);
    const hours = fromCloses(Array.from({ length: 1300 }, () => 100), '4h', now - 1300 * TIMEFRAME_MS['4h']);
    const openCandle = candle(closes.length, { h: 1000, l: 90, c: 1000 });
    const input = { strategy: futures, candles: { '4h': hours, '1d': [...days, openCandle], '1w': weeks }, position: null };
    const closedOnly = evaluate({ ...input, candles: { ...input.candles, '1d': days }, nowMs: now });
    const withOpen = evaluate({ ...input, nowMs: now });
    expect(withOpen).toEqual(closedOnly);
    expect(withOpen.type).not.toBe('enter');
    // Once it closes, the same candle is a first green and the long enters.
    const afterClose = evaluate({ ...input, nowMs: openCandle.closeTime + 1 });
    expect(afterClose).toMatchObject({ type: 'enter', side: 'long', kind: 'primary' });
  });
});
