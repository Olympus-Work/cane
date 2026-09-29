import { Logger } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { BinanceTrading, OrderState } from '../binance/trading.js';
import { baseAsset, refOf, type ExitReason, type Executor, type PlannedEntry } from './executor.js';
import type { KeyedMutex } from './engine.js';
import type { Notifier } from './ports.js';
import { NOT_SENT, type EngineStore, type OrderRow, type PositionRow, type StrategyRow } from './store.js';

/** Algo order statuses once the trigger fired. */
const ALGO_TRIGGERED = ['TRIGGERING', 'TRIGGERED', 'FINISHED'];

export interface ReconcilerDeps {
  store: EngineStore;
  executor: Executor;
  trading: BinanceTrading;
  notifier: Notifier;
  mutex: KeyedMutex;
  now: () => number;
}

/**
 * B12: compares what the DB recorded with Binance (the source of truth) on
 * start-up, every 5 minutes and after user-data events, and repairs it:
 * - finishes entries sent just before a crash (AC6);
 * - books positions Binance already closed (stop / take-profit / liquidation);
 * - re-places a missing stop for the quantity actually held;
 * - marks mismatches (unknown position, quantity differs, missing stop) as
 *   `needs_attention` + `reconcile_mismatch`, which blocks new entries.
 * It never opens positions or touches positions it did not open (B11.3).
 */
export class Reconciler {
  private readonly log = new Logger('Reconciler');

  constructor(private readonly d: ReconcilerDeps) {}

  async reconcileAll(): Promise<void> {
    for (const s of await this.d.store.managedStrategies()) {
      try {
        await this.reconcileOne(s.id);
      } catch (err) {
        this.log.error(`${s.id} reconcile failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  reconcileOne(strategyId: string): Promise<void> {
    return this.d.mutex.run(strategyId, async () => {
      const s = await this.d.store.strategy(strategyId);
      if (s) await this.reconcile(s);
    });
  }

  private async reconcile(s: StrategyRow): Promise<void> {
    await this.finishPendingEntries(s);
    const p = await this.d.store.openPosition(s.id);
    if (p && (await this.finishPendingExit(s, p))) return;
    if (s.market === 'futures') await this.futures(s, p);
    else if (p) await this.spot(s, p);
  }

  /** AC6: an entry row written before a crash — Binance decides what happened. */
  private async finishPendingEntries(s: StrategyRow): Promise<void> {
    for (const o of await this.d.store.pendingEntries(s.id)) {
      const st = await this.d.trading.query(refOf(o));
      if (!st) {
        await this.d.store.updateOrder(o.clientOrderId, { status: NOT_SENT });
        await this.d.notifier.notify('order_rejected', s.id, { pair: s.pair, reason: 'entry was not sent before a restart' });
        continue;
      }
      if (st.executedQty.isZero()) {
        await this.d.store.updateOrder(o.clientOrderId, { status: st.status, exchangeOrderId: st.exchangeId });
        continue;
      }
      const decision = (o.signalId === null ? null : await this.d.store.signalDecision(o.signalId)) as { entry?: PlannedEntry } | null;
      if (!decision?.entry) {
        await this.mismatch(s, 'Filled entry without a recorded plan');
        continue;
      }
      this.log.warn(`${s.id} finishing entry ${o.clientOrderId} after a restart`);
      await this.d.executor.recordEntry(s, decision.entry, st);
    }
  }

  private async futures(s: StrategyRow, p: PositionRow | null): Promise<void> {
    const { amount } = await this.d.trading.futuresPosition(s.pair);
    if (!p) {
      if (!amount.isZero()) await this.mismatch(s, `Unknown position on Binance: ${amount.toFixed()} ${s.pair}`); // B12.3
      return;
    }
    if (amount.isZero()) {
      await this.closedOnExchange(s, p);
      return;
    }
    const held = amount.abs();
    const heldSide = amount.gt(0) ? 'long' : 'short';
    if (heldSide !== p.side || !held.eq(p.qty)) {
      await this.mismatch(s, `Quantity differs: Binance ${amount.toFixed()}, recorded ${p.side} ${p.qty}`);
    }
    if (heldSide === p.side) await this.ensureStop(s, p, held);
  }

  private async spot(s: StrategyRow, p: PositionRow): Promise<void> {
    const stops = (await this.d.store.protectiveOrders(p.id)).filter((o) => o.purpose === 'stop');
    const open = await this.d.trading.openClientIds('spot', s.pair);
    for (const o of stops) {
      if (open.has(o.clientOrderId)) {
        const balance = (await this.d.trading.spotBalances()).get(baseAsset(s.pair));
        const held = balance ? balance.free.plus(balance.locked) : new Decimal(0);
        if (held.lt(p.qty)) await this.mismatch(s, `Quantity differs: holding ${held.toFixed()}, recorded ${p.qty}`);
        return;
      }
      const st = await this.d.trading.query(refOf(o));
      const reason = await this.spotFillReason(o, st);
      if (reason) {
        await this.d.store.updateOrder(o.clientOrderId, { status: st?.status ?? 'FILLED' });
        await this.d.executor.recordClose(s, p, reason);
        return;
      }
      await this.d.store.updateOrder(o.clientOrderId, { status: st?.status ?? 'NOT_FOUND' });
    }
    // No open stop and none filled: re-place for what is actually held (B12.2).
    const free = (await this.d.trading.spotBalances()).get(baseAsset(s.pair))?.free ?? new Decimal(0);
    await this.mismatch(s, 'Missing stop');
    await this.replaceStop(s, p, Decimal.min(free, p.qty));
  }

  /** Whether a spot stop (or OCO) sold the position, and through which leg. */
  private async spotFillReason(o: OrderRow, st: OrderState | null): Promise<'stop' | 'take_profit' | null> {
    if (o.type !== 'OCO') return st && st.executedQty.gt(0) ? 'stop' : null;
    const leg = async (action: 'stop' | 'tp') => this.d.trading.query({ ...refOf(o), kind: 'order', clientId: o.clientOrderId.replace(/-oco$/, `-${action}`) });
    if ((await leg('stop'))?.executedQty.gt(0)) return 'stop';
    if ((await leg('tp'))?.executedQty.gt(0)) return 'take_profit';
    return null;
  }

  /** USDⓈ-M position gone on Binance: find out why, book it, clean up (B7.3, E7, E9). */
  private async closedOnExchange(s: StrategyRow, p: PositionRow): Promise<void> {
    const protective = await this.d.store.protectiveOrders(p.id);
    let reason: ExitReason | null = null;
    for (const o of protective) {
      const st = await this.d.trading.query(refOf(o));
      if (st && (ALGO_TRIGGERED.includes(st.status) || st.status === 'FILLED')) reason = o.purpose === 'take_profit' ? 'take_profit' : 'stop';
    }
    if (!reason) reason = (await this.d.trading.futuresLiquidatedSince(s.pair, p.openedAt.getTime())) ? 'liquidated' : 'manual';

    for (const o of protective) await this.d.executor.cancelRow(o); // the other leg stays open otherwise
    await this.d.executor.recordClose(s, p, reason);
    if (reason === 'liquidated') await this.mismatch(s, 'Position liquidated'); // E9
    if (reason === 'manual') await this.mismatch(s, 'Position closed outside the system');
  }

  /**
   * An exit written before a crash: if Binance filled it, book the close with
   * the reason it was sent for. Returns true when the position was booked.
   */
  private async finishPendingExit(s: StrategyRow, p: PositionRow): Promise<boolean> {
    for (const o of await this.d.store.unbookedExits(p.id)) {
      const st = await this.d.trading.query(refOf(o));
      if (!st || st.executedQty.isZero()) {
        await this.d.store.updateOrder(o.clientOrderId, { status: st?.status ?? NOT_SENT });
        continue;
      }
      await this.d.store.updateOrder(o.clientOrderId, { status: st.status, exchangeOrderId: st.exchangeId, filledQty: st.executedQty.toFixed() });
      for (const prot of await this.d.store.protectiveOrders(p.id)) await this.d.executor.cancelRow(prot); // B7.3
      await this.d.executor.recordClose(s, p, await this.exitReason(o));
      return true;
    }
    return false;
  }

  /** Why an exit order was sent: its exit signal, or the action in its client ID. */
  private async exitReason(o: OrderRow): Promise<ExitReason> {
    const d = (o.signalId === null ? null : await this.d.store.signalDecision(o.signalId)) as { reason?: string } | null;
    if (d?.reason === 'first_red' || d?.reason === 'first_green') return d.reason;
    if (o.clientOrderId.endsWith('-kill')) return 'kill_switch';
    return 'stop'; // `bail`: the entry fill had already crossed its stop (E6)
  }

  /** B12.2: the position must have an open stop on Binance; if not, re-place it for what is held. */
  private async ensureStop(s: StrategyRow, p: PositionRow, held: Decimal): Promise<void> {
    const stops = (await this.d.store.protectiveOrders(p.id)).filter((o) => o.purpose === 'stop');
    const open = await this.d.trading.openClientIds('futures', s.pair);
    if (stops.some((o) => open.has(o.clientOrderId))) return;
    for (const o of stops) await this.d.store.updateOrder(o.clientOrderId, { status: (await this.d.trading.query(refOf(o)))?.status ?? 'NOT_FOUND' });
    await this.mismatch(s, 'Missing stop');
    await this.replaceStop(s, p, held);
  }

  private async replaceStop(s: StrategyRow, p: PositionRow, qty: Decimal): Promise<void> {
    if (qty.lte(0)) return;
    await this.d.executor.protect(s, { ...p, qty: qty.toFixed() }, this.d.now());
  }

  /** Marks the strategy `needs_attention` and notifies once per distinct reason. */
  private async mismatch(s: StrategyRow, reason: string): Promise<void> {
    if (s.status === 'needs_attention' && s.attentionReason === reason) return;
    this.log.warn(`${s.id} ${reason}`);
    await this.d.executor.attention(s, reason, 'reconcile_mismatch', { pair: s.pair });
    s.status = 'needs_attention';
    s.attentionReason = reason;
  }
}
