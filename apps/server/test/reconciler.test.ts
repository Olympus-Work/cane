import { Decimal } from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import type { BinanceTrading, OrderState } from '../src/binance/trading.js';
import { KeyedMutex } from '../src/engine/engine.js';
import type { Executor } from '../src/engine/executor.js';
import type { Notifier } from '../src/engine/ports.js';
import { Reconciler } from '../src/engine/reconciler.js';
import type { EngineStore, OrderRow, StrategyRow } from '../src/engine/store.js';

const strategy = { id: 'S-01', pair: 'BTCUSDT', market: 'futures', status: 'enabled', attentionReason: null } as unknown as StrategyRow;
const pendingEntry = {
  clientOrderId: 'S-01-1727740800000-entry',
  market: 'futures',
  type: 'MARKET',
  pair: 'BTCUSDT',
  signalId: 7,
} as unknown as OrderRow;

function setup(state: Partial<OrderState> | null) {
  const store = {
    strategy: vi.fn(async () => strategy),
    pendingEntries: vi.fn(async () => [pendingEntry]),
    updateOrder: vi.fn(async () => undefined),
    signalDecision: vi.fn(async () => ({ entry: { side: 'long' } })),
    openPosition: vi.fn(async () => null),
  };
  const trading = {
    query: vi.fn(async () => (state ? { exchangeId: '1', executedQty: new Decimal(0), avgPrice: null, ...state } : null)),
    futuresPosition: vi.fn(async () => ({ amount: new Decimal(0), entryPrice: new Decimal(0), liquidationPrice: null })),
  };
  const executor = { recordEntry: vi.fn(async () => null), attention: vi.fn(async () => undefined) };
  const notifier: Notifier = { notify: vi.fn(async () => undefined) };
  const reconciler = new Reconciler({
    store: store as unknown as EngineStore,
    trading: trading as unknown as BinanceTrading,
    executor: executor as unknown as Executor,
    notifier,
    mutex: new KeyedMutex(),
    now: () => 0,
  });
  return { reconciler, store, executor, notifier };
}

describe('Reconciler: entries written before a crash (AC6)', () => {
  it('an entry Binance still works on stays PENDING for the next pass', async () => {
    for (const status of ['NEW', 'PARTIALLY_FILLED']) {
      const { reconciler, store, executor } = setup({ status, executedQty: new Decimal(status === 'NEW' ? 0 : '0.001') });
      await reconciler.reconcileOne('S-01');
      expect(store.updateOrder).not.toHaveBeenCalled();
      expect(executor.recordEntry).not.toHaveBeenCalled();
    }
  });

  it('a filled entry is recorded with its plan', async () => {
    const { reconciler, executor } = setup({ status: 'FILLED', executedQty: new Decimal('0.002'), avgPrice: new Decimal('84000') });
    await reconciler.reconcileOne('S-01');
    expect(executor.recordEntry).toHaveBeenCalledWith(strategy, { side: 'long' }, expect.objectContaining({ status: 'FILLED' }));
  });

  it('an entry that ended unfilled keeps its final status; one never received is NOT_SENT', async () => {
    const expired = setup({ status: 'EXPIRED' });
    await expired.reconciler.reconcileOne('S-01');
    expect(expired.store.updateOrder).toHaveBeenCalledWith(pendingEntry.clientOrderId, { status: 'EXPIRED', exchangeOrderId: '1' });

    const missing = setup(null);
    await missing.reconciler.reconcileOne('S-01');
    expect(missing.store.updateOrder).toHaveBeenCalledWith(pendingEntry.clientOrderId, { status: 'NOT_SENT' });
    expect(missing.notifier.notify).toHaveBeenCalledWith('order_rejected', 'S-01', expect.anything());
  });
});
