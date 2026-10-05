import { describe, expect, it, vi } from 'vitest';
import { KeyedMutex } from '../src/engine/engine.js';
import type { Executor } from '../src/engine/executor.js';
import { KILL_RETRY_MS, KillSwitch } from '../src/engine/kill-switch.js';
import type { Notifier } from '../src/engine/ports.js';
import type { EngineStore, OrderRow, PositionRow, StrategyRow } from '../src/engine/store.js';

type Status = StrategyRow['status'];

const strat = (id: string, pair: string, status: Status, market: 'spot' | 'futures' = 'futures'): StrategyRow => ({ id, pair, market, status, attentionReason: null }) as StrategyRow;
const pos = (strategyId: string, side: 'long' | 'short' = 'long'): PositionRow => ({ id: Number(strategyId.slice(2)), strategyId, side, qty: '0.002' }) as PositionRow;
const order = (clientOrderId: string): OrderRow => ({ clientOrderId }) as OrderRow;

/** In-memory stand-in for the few EngineStore queries the kill switch uses. */
function fakeStore(rows: StrategyRow[], positions: Record<string, PositionRow>, entries: Record<string, OrderRow[]> = {}, pendingKey: Record<number, number> = {}) {
  const byId = new Map(rows.map((s) => [s.id, { ...s }]));
  const store = {
    killableStrategies: async () => [...byId.values()].filter((s) => s.status !== 'closed'),
    strategy: async (id: string) => (byId.get(id) ? { ...byId.get(id)! } : null),
    setStrategyStatus: vi.fn(async (id: string, status: Status, reason: string | null) => {
      Object.assign(byId.get(id)!, { status, attentionReason: reason });
    }),
    openPosition: async (id: string) => positions[id] ?? null,
    openEntryOrders: async (id: string) => entries[id] ?? [],
    openProtectiveOrders: async () => [],
    pendingKillKey: async (positionId: number) => pendingKey[positionId] ?? null,
  };
  return { store: store as unknown as EngineStore, byId, setStrategyStatus: store.setStrategyStatus };
}

function setup(opts: { rows: StrategyRow[]; positions?: Record<string, PositionRow>; entries?: Record<string, OrderRow[]>; pendingKey?: Record<number, number>; engineOff?: boolean; exitFails?: string[] }) {
  const fs = fakeStore(opts.rows, opts.positions ?? {}, opts.entries ?? {}, opts.pendingKey ?? {});
  const events: string[] = [];
  const executor = {
    cancelRow: vi.fn(async (o: OrderRow) => {
      events.push(`cancel ${o.clientOrderId}`);
      return 'canceled' as const;
    }),
    exit: vi.fn(async (s: StrategyRow) => {
      events.push(`exit ${s.id}`);
      if (opts.exitFails?.includes(s.id)) {
        await fs.store.setStrategyStatus(s.id, 'needs_attention', 'Could not close the position: 503');
        return null;
      }
      return {} as never;
    }),
    attention: vi.fn(async (s: StrategyRow, reason: string) => {
      await fs.store.setStrategyStatus(s.id, 'needs_attention', reason);
    }),
  };
  const notify = vi.fn(async () => undefined);
  const notifier: Notifier = { notify };
  const ks = new KillSwitch({ store: fs.store, executor: opts.engineOff ? null : (executor as unknown as Executor), mutex: new KeyedMutex(), notifier, now: () => 1_000 });
  return { ks, fs, executor, notify, events };
}

describe('KillSwitch', () => {
  it('disables every strategy, skips closed ones and closes the position with a bounded retry', async () => {
    const { ks, fs, executor, notify } = setup({
      rows: [strat('S-01', 'BTCUSDT', 'enabled'), strat('S-02', 'ETHUSDT', 'disabled'), strat('S-03', 'SOLUSDT', 'closed'), strat('S-04', 'XRPUSDT', 'needs_attention')],
      positions: { 'S-01': pos('S-01') },
    });
    const rows = await ks.run();

    expect(rows).toEqual([{ pair: 'BTCUSDT', market: 'futures', what: 'Long 0.002', status: 'closed' }]);
    expect(fs.byId.get('S-01')!.status).toBe('disabled');
    expect(fs.byId.get('S-02')!.status).toBe('disabled');
    expect(fs.byId.get('S-03')!.status).toBe('closed'); // untouched
    expect(fs.byId.get('S-04')!.status).toBe('disabled');
    expect(executor.exit).toHaveBeenCalledTimes(1);
    expect(executor.exit).toHaveBeenCalledWith(expect.objectContaining({ id: 'S-01' }), expect.anything(), 'kill_switch', 1_000, 'kill', null, KILL_RETRY_MS);
    expect(notify).toHaveBeenCalledWith('kill_switch', null, { what: 'BTCUSDT futures closed' });
  });

  it('cancels a pending entry order before it closes, and reports a strategy with only orders as cancelled', async () => {
    const { ks, events } = setup({
      rows: [strat('S-01', 'BTCUSDT', 'enabled'), strat('S-02', 'ETHUSDT', 'enabled')],
      positions: { 'S-01': pos('S-01') },
      entries: { 'S-01': [order('S-01-5-entry')], 'S-02': [order('S-02-5-entry'), order('S-02-9-entry')] },
    });
    const rows = await ks.run();

    expect(events.indexOf('cancel S-01-5-entry')).toBeLessThan(events.indexOf('exit S-01'));
    expect(rows).toEqual([
      { pair: 'BTCUSDT', market: 'futures', what: 'Long 0.002 · 1 order cancelled', status: 'closed' },
      { pair: 'ETHUSDT', market: 'futures', what: '2 orders cancelled', status: 'cancelled' },
    ]);
  });

  it('reports a failed close as failed, keeps the strategy blocked and still handles the others', async () => {
    const { ks, fs, notify } = setup({
      rows: [strat('S-01', 'BTCUSDT', 'enabled'), strat('S-02', 'ETHUSDT', 'enabled', 'spot')],
      positions: { 'S-01': pos('S-01'), 'S-02': pos('S-02') },
      exitFails: ['S-01'],
    });
    const rows = await ks.run();

    expect(rows.map((r) => [r.pair, r.status])).toEqual([['BTCUSDT', 'failed'], ['ETHUSDT', 'closed']]);
    expect(rows[0]!.what).toContain('503');
    expect(fs.byId.get('S-01')!.status).toBe('needs_attention'); // still blocks entries (B12.2)
    expect(fs.byId.get('S-02')!.status).toBe('disabled');
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenNthCalledWith(1, 'kill_switch', null, { what: 'BTCUSDT futures failed' });
    expect(notify).toHaveBeenNthCalledWith(2, 'kill_switch', null, { what: 'ETHUSDT spot closed' });
  });

  it('reuses the key of an earlier unanswered kill close so a second press sends no second order ID', async () => {
    const { ks, executor } = setup({ rows: [strat('S-01', 'BTCUSDT', 'needs_attention')], positions: { 'S-01': pos('S-01') }, pendingKey: { 1: 777 } });
    await ks.run();
    expect(executor.exit).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'kill_switch', 777, 'kill', null, KILL_RETRY_MS);
  });

  it('a failing cancel marks the strategy needs_attention and is reported failed, not thrown', async () => {
    const { ks, fs, executor } = setup({ rows: [strat('S-01', 'BTCUSDT', 'enabled')], entries: { 'S-01': [order('S-01-5-entry')] } });
    executor.cancelRow.mockRejectedValueOnce(new Error('network down'));
    const rows = await ks.run();
    expect(rows).toEqual([{ pair: 'BTCUSDT', market: 'futures', what: 'Could not cancel an order: network down', status: 'failed' }]);
    expect(fs.byId.get('S-01')!.status).toBe('needs_attention');
    expect(executor.exit).not.toHaveBeenCalled();
  });

  it('engine off: disables everything, reports open positions as failed, sends no order', async () => {
    const { ks, fs, notify } = setup({
      rows: [strat('S-01', 'BTCUSDT', 'enabled'), strat('S-02', 'ETHUSDT', 'enabled')],
      positions: { 'S-01': pos('S-01', 'short') },
      engineOff: true,
    });
    const rows = await ks.run();
    expect(rows).toEqual([{ pair: 'BTCUSDT', market: 'futures', what: 'Short 0.002 · engine is off, close it on Binance', status: 'failed' }]);
    expect(fs.byId.get('S-01')!.status).toBe('disabled');
    expect(fs.byId.get('S-02')!.status).toBe('disabled');
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('with nothing to stop it sends no notification', async () => {
    const { ks, notify } = setup({ rows: [strat('S-01', 'BTCUSDT', 'disabled')] });
    expect(await ks.run()).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });
});
