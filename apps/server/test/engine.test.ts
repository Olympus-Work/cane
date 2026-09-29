import { Decimal } from 'decimal.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMEFRAME_MS, type Candle, type Decision, type Timeframe } from '@cane/core';
import { Engine, KeyedMutex, evaluatedCandle, EVALUATION_GRACE_MS } from '../src/engine/engine.js';
import type { Executor } from '../src/engine/executor.js';
import type { JevCall } from '../src/engine/ports.js';
import { EngineStore } from '../src/engine/store.js';
import { DATABASE_URL, freshDb } from './support/db.js';

const H4 = TIMEFRAME_MS['4h'];
const D1 = TIMEFRAME_MS['1d'];
const KEY = 1_727_740_800_000; // 2024-10-01 00:00 UTC, 4H- and 1D-aligned
const d = (v: string) => new Decimal(v);

describe('evaluatedCandle and KeyedMutex', () => {
  it('evaluatedCandle is the newest 4H candle closed at least the grace period before now', () => {
    expect(evaluatedCandle(KEY + H4 + EVALUATION_GRACE_MS)).toBe(KEY);
    expect(evaluatedCandle(KEY + H4 + EVALUATION_GRACE_MS - 1)).toBe(KEY - H4);
  });

  it('runs jobs of the same key one after another, different keys concurrently, and a rejection does not block the next', async () => {
    const order: string[] = [];
    const mutex = new KeyedMutex();
    let resolveA!: () => void;
    const a = new Promise<void>((r) => {
      resolveA = r;
    });

    const jobA = mutex.run('x', async () => {
      order.push('A-start');
      await a;
      order.push('A-end');
    });
    const jobB = mutex.run('x', async () => {
      order.push('B-start');
    });
    const jobB2 = mutex.run('y', async () => {
      order.push('B2-start');
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['A-start', 'B2-start']); // B waits for A; B2 on another key already started
    resolveA();
    await Promise.all([jobA, jobB, jobB2]);
    expect(order).toEqual(['A-start', 'B2-start', 'A-end', 'B-start']);

    // A rejected job does not block the next one on that key.
    const order2: string[] = [];
    const m2 = new KeyedMutex();
    const rej = m2.run('x', async () => {
      order2.push('R-start');
      throw new Error('boom');
    });
    const after = m2.run('x', async () => {
      order2.push('AFTER');
    });
    await expect(rej).rejects.toThrow('boom');
    await after;
    expect(order2).toEqual(['R-start', 'AFTER']);
  });
});

describe.skipIf(!DATABASE_URL)('Engine.evaluate', () => {
  let pool: pg.Pool;
  let store: EngineStore;
  let candles: ReturnType<typeof vi.fn>;
  let enter: ReturnType<typeof vi.fn>;
  let exit: ReturnType<typeof vi.fn>;
  let moveStop: ReturnType<typeof vi.fn>;
  let executor: Executor;
  let jev: { classify: ReturnType<typeof vi.fn> };
  let decideFn: ReturnType<typeof vi.fn>;
  let next: Decision;
  let engine: Engine;

  const fail: JevCall = {
    result: { ok: false, reason: 'error' },
    model: 'none',
    request: null,
    response: null,
    error: 'x',
    latencyMs: null,
  };
  const okJev: JevCall = {
    result: { ok: true, factors: [{ present: true, confidence: 0.9 }, { present: true, confidence: 0.9 }, { present: true, confidence: 0.9 }] },
    model: 'none',
    request: null,
    response: null,
    error: null,
    latencyMs: null,
  };

  /** 260 candles of `tf` ending with the last one that closes before `nowMs`. */
  function candlesFor(market: string, pair: string, tf: Timeframe, nowMs: number): Candle[] {
    const dur = TIMEFRAME_MS[tf];
    const alignedStart = Math.floor(nowMs / dur) * dur - 260 * dur;
    const out: Candle[] = [];
    for (let i = 0; i < 260; i++) {
      const openTime = alignedStart + i * dur;
      const close = d(String(100 + (i % 2)));
      out.push({ openTime, closeTime: openTime + dur - 1, open: close, close, high: close.plus(1), low: close.minus(1), volume: d('1') });
    }
    return out;
  }

  /** Insert a strategy row. Futures rows carry leverage + margin mode; spot rows omit them. */
  async function strategy(id: string, pair: string, status = 'enabled', market: 'futures' | 'spot' = 'futures'): Promise<void> {
    if (market === 'futures') {
      await pool.query("insert into strategies(id, pair, market, status, leverage, margin_mode) values ($1, $2, 'futures', $3, 5, 'isolated')", [id, pair, status]);
    } else {
      await pool.query("insert into strategies(id, pair, market, status) values ($1, $2, 'spot', $3)", [id, pair, status]);
    }
  }

  /** Insert an open long futures position; returns the new id. */
  async function openPosition(strategyId: string, pair: string): Promise<number> {
    const { rows } = await pool.query<{ id: number }>(
      `insert into positions(strategy_id, market, pair, side, status, entry_kind, signal_timeframe, signal_candle_open_time,
                              qty, entry_price, stop_price, size_pct, opened_at)
       values ($1, 'futures', $2, 'long', 'open', 'primary', '1d', $3, '0.002', '100', '95', '10', now())
       returning id`,
      [strategyId, pair, KEY - D1],
    );
    return Number(rows[0]!.id);
  }

  beforeEach(async () => {
    await pool?.end();
    pool = await freshDb();
    store = new EngineStore(drizzle(pool));

    candles = vi.fn(async (_market: string, pair: string, tf: Timeframe, nowMs: number): Promise<Candle[]> => {
      if (pair === 'ETHUSDT') throw new Error('candles unavailable for ETHUSDT');
      return candlesFor(_market, pair, tf, nowMs);
    });
    enter = vi.fn(async () => null);
    exit = vi.fn(async () => null);
    moveStop = vi.fn(async () => undefined);
    executor = { enter, exit, moveStop } as unknown as Executor;
    jev = { classify: vi.fn(async (): Promise<JevCall> => fail) };
    decideFn = vi.fn((): Decision => next);
    next = { type: 'none', reason: 'no_signal' };
    engine = new Engine({
      store,
      executor,
      candles: candles as never,
      jev: jev as never,
      mutex: new KeyedMutex(),
      now: () => KEY + H4 + 60_000,
      decideFn: decideFn as never,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function rows(): Promise<{ strategy_id: string; timeframe: string; t: string }[]> {
    const { rows } = await pool.query<{ strategy_id: string; timeframe: string; t: string }>(
      'select strategy_id, timeframe, candle_open_time::text as t from signals order by id',
    );
    return rows;
  }

  it('late entry: executor gets the intent keyed to the evaluated 4H candle', async () => {
    await strategy('S-01', 'BTCUSDT');
    next = {
      type: 'enter',
      side: 'long',
      kind: 'late',
      signal: { timeframe: '4h', openTime: KEY },
      refPrice: d('100'),
      stop: d('95'),
      stopSource: 'trail',
      takeProfit: d('110'),
      trend1w: 'bullish',
    };

    await engine.evaluate('S-01', KEY);

    expect(enter).toHaveBeenCalledTimes(1);
    const [s, intent] = enter.mock.calls[0] as [{ id: string }, Record<string, unknown>];
    expect(s.id).toBe('S-01');
    expect(intent.key).toBe(KEY);
    expect(intent.kind).toBe('late');
    expect(intent.side).toBe('long');
    expect(intent.signalTimeframe).toBe('4h');
    expect(intent.signalOpenTime).toBe(KEY);
    expect(intent.jev).toBeNull();
    expect(new Decimal(String(intent.takeProfit))).toEqual(d('110'));
    expect(typeof intent.signalId).toBe('number');
    expect(jev.classify).not.toHaveBeenCalled();
    expect(await rows()).toEqual([{ strategy_id: 'S-01', timeframe: '4h', t: String(KEY) }]);
    expect((decideFn.mock.calls[0] as [{ nowMs: number }])[0].nowMs).toBe(KEY + H4);
  });

  it('the same 4H candle is evaluated once (B1.2)', async () => {
    await strategy('S-01', 'BTCUSDT');
    next = {
      type: 'enter',
      side: 'long',
      kind: 'late',
      signal: { timeframe: '4h', openTime: KEY },
      refPrice: d('100'),
      stop: d('95'),
      stopSource: 'trail',
      takeProfit: d('110'),
      trend1w: 'bullish',
    };

    await engine.evaluate('S-01', KEY);
    await engine.evaluate('S-01', KEY);

    expect(enter).toHaveBeenCalledTimes(1);
  });

  it('primary entry: Jev is asked and the 1D candle is used once (B7.4)', async () => {
    await strategy('S-01', 'BTCUSDT');
    next = {
      type: 'enter',
      side: 'long',
      kind: 'primary',
      signal: { timeframe: '1d', openTime: KEY - D1 },
      refPrice: d('100'),
      stop: d('95'),
      stopSource: 'trail',
      takeProfit: null,
      trend1w: 'bullish',
    };

    await engine.evaluate('S-01', KEY);
    expect(enter).toHaveBeenCalledTimes(1);
    const [, intent] = enter.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(intent.jev).toEqual(fail);
    expect(intent.kind).toBe('primary');
    expect(jev.classify).toHaveBeenCalledTimes(1);
    const arg = jev.classify.mock.calls[0]![0] as { side: string; timeframe: string };
    expect(arg.side).toBe('long');
    expect(arg.timeframe).toBe('1d');

    // The 1D candle is consumed: a later 4H evaluation on the same decision does not re-enter.
    await engine.evaluate('S-01', KEY + H4);
    expect(enter).toHaveBeenCalledTimes(1);
    expect(await rows()).toEqual([
      { strategy_id: 'S-01', timeframe: '4h', t: String(KEY) },
      { strategy_id: 'S-01', timeframe: '1d', t: String(KEY - D1) },
      { strategy_id: 'S-01', timeframe: '4h', t: String(KEY + H4) },
    ]);
  });

  it('no new entries while needs_attention or disabled', async () => {
    await strategy('S-01', 'BTCUSDT', 'needs_attention');
    next = {
      type: 'enter',
      side: 'long',
      kind: 'late',
      signal: { timeframe: '4h', openTime: KEY },
      refPrice: d('100'),
      stop: d('95'),
      stopSource: 'trail',
      takeProfit: d('110'),
      trend1w: 'bullish',
    };

    await engine.evaluate('S-01', KEY);

    expect(enter).not.toHaveBeenCalled();
    expect(await rows()).toEqual([{ strategy_id: 'S-01', timeframe: '4h', t: String(KEY) }]);
  });

  it('a data gap is not recorded and is retried', async () => {
    await strategy('S-01', 'BTCUSDT');
    next = { type: 'none', reason: 'data_gap', timeframes: ['1d'] };
    await engine.evaluate('S-01', KEY);
    expect(await rows()).toEqual([]);

    next = { type: 'none', reason: 'no_signal' };
    await engine.evaluate('S-01', KEY);
    expect(await rows()).toEqual([{ strategy_id: 'S-01', timeframe: '4h', t: String(KEY) }]);
  });

  it('exit signal: executor.exit with the 1D candle consumed', async () => {
    await strategy('S-01', 'BTCUSDT');
    const posId = await openPosition('S-01', 'BTCUSDT');
    next = { type: 'exit', side: 'long', reason: 'first_red', signal: { timeframe: '1d', openTime: KEY - D1 }, refPrice: d('90') };

    await engine.evaluate('S-01', KEY);

    expect(exit).toHaveBeenCalledTimes(1);
    const [s, p, reason, key, action, signalId] = exit.mock.calls[0] as [{ id: string }, { id: number }, string, number, string, number];
    expect(s.id).toBe('S-01');
    expect(p.id).toBe(posId);
    expect(reason).toBe('first_red');
    expect(key).toBe(KEY);
    expect(action).toBe('exit');
    expect(typeof signalId).toBe('number');
    expect(await rows()).toContainEqual({ strategy_id: 'S-01', timeframe: '1d', t: String(KEY - D1) });
    const pos = (decideFn.mock.calls[0] as [{ position: { side: string; kind: string; stop: Decimal } }])[0].position;
    expect(pos.side).toBe('long');
    expect(pos.kind).toBe('primary');
    expect(pos.stop).toEqual(d('95'));
  });

  it('profitable futures exit asks Jev for the flip side; a failed Jev means no flip', async () => {
    await strategy('S-01', 'BTCUSDT');
    const posId = await openPosition('S-01', 'BTCUSDT');
    exit.mockResolvedValueOnce({ netPnl: d('5') } as never);
    next = { type: 'exit', side: 'long', reason: 'first_red', signal: { timeframe: '1d', openTime: KEY - D1 }, refPrice: d('90') };

    await engine.evaluate('S-01', KEY);

    expect(exit).toHaveBeenCalledTimes(1);
    expect(jev.classify).toHaveBeenCalledTimes(1);
    const arg = jev.classify.mock.calls[0]![0] as { side: string; timeframe: string };
    expect(arg.side).toBe('short');
    expect(arg.timeframe).toBe('1d');
    expect(enter).not.toHaveBeenCalled();
    expect(posId).toBeGreaterThan(0);
  });

  it('flip opens the opposite side when Jev finds >= 2 factors (B7.5)', async () => {
    await strategy('S-01', 'BTCUSDT');
    await openPosition('S-01', 'BTCUSDT');
    vi.mocked(jev.classify).mockResolvedValueOnce(okJev);
    exit.mockResolvedValueOnce({ netPnl: d('5') } as never);
    next = { type: 'exit', side: 'long', reason: 'first_red', signal: { timeframe: '1d', openTime: KEY - D1 }, refPrice: d('90') };

    await engine.evaluate('S-01', KEY);

    expect(enter).toHaveBeenCalledTimes(1);
    const [, intent] = enter.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(intent.kind).toBe('flip');
    expect(intent.side).toBe('short');
    expect(intent.signalOpenTime).toBe(KEY - D1);
    expect(intent.takeProfit).toBeNull();
    expect(intent.trend1w).toBeNull();
    expect(intent.jev).toEqual(okJev);
    expect(new Decimal(String(intent.stop)).gt(new Decimal(String(intent.refPrice)))).toBe(true);
  });

  it('no flip for spot or a losing exit', async () => {
    // (a) spot strategy: the flip check is skipped entirely.
    await strategy('S-01', 'BTCUSDT', 'enabled', 'spot');
    const { rows: spotRows } = await pool.query<{ id: number }>(
      `insert into positions(strategy_id, market, pair, side, status, entry_kind, signal_timeframe, signal_candle_open_time,
                              qty, entry_price, stop_price, size_pct, opened_at)
       values ('S-01', 'spot', 'BTCUSDT', 'long', 'open', 'primary', '1d', $1, '0.002', '100', '95', '10', now())
       returning id`,
      [KEY - D1],
    );
    expect(spotRows[0]!.id).toBeDefined();
    exit.mockResolvedValueOnce({ netPnl: d('5') } as never);
    next = { type: 'exit', side: 'long', reason: 'first_red', signal: { timeframe: '1d', openTime: KEY - D1 }, refPrice: d('90') };
    await engine.evaluate('S-01', KEY);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(jev.classify).not.toHaveBeenCalled();
    expect(enter).not.toHaveBeenCalled();

    // (b) futures but a losing exit: Jev is not asked.
    await pool.query('delete from positions');
    await pool.query('delete from signals');
    await pool.query('delete from strategies where id = $1', ['S-01']);
    await strategy('S-01', 'BTCUSDT');
    await openPosition('S-01', 'BTCUSDT');
    exit.mockResolvedValueOnce({ netPnl: d('-1') } as never);
    next = { type: 'exit', side: 'long', reason: 'first_red', signal: { timeframe: '1d', openTime: KEY - D1 }, refPrice: d('90') };
    await engine.evaluate('S-01', KEY);
    expect(jev.classify).not.toHaveBeenCalled();
    expect(enter).not.toHaveBeenCalled();
  });

  it('move_stop goes to the executor', async () => {
    await strategy('S-01', 'BTCUSDT');
    const posId = await openPosition('S-01', 'BTCUSDT');
    next = { type: 'move_stop', side: 'long', stop: d('97'), signal: { timeframe: '1d', openTime: KEY - D1 } };

    await engine.evaluate('S-01', KEY);

    expect(moveStop).toHaveBeenCalledTimes(1);
    const [s, p, newStop, key] = moveStop.mock.calls[0] as [{ id: string }, { id: number }, Decimal, number];
    expect(s.id).toBe('S-01');
    expect(p.id).toBe(posId);
    expect(newStop).toEqual(d('97'));
    expect(key).toBe(KEY);
  });

  it('tick evaluates every managed strategy and one failure does not stop the others', async () => {
    await strategy('S-01', 'BTCUSDT');
    await strategy('S-02', 'ETHUSDT');
    next = { type: 'none', reason: 'no_signal' };

    await expect(engine.tick()).resolves.toBeUndefined();
    expect(await rows()).toEqual([{ strategy_id: 'S-01', timeframe: '4h', t: String(KEY) }]);
  });
});
