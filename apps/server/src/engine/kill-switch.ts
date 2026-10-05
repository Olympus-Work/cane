import { Decimal } from 'decimal.js';
import type { KeyedMutex } from './engine.js';
import { errText, type Executor } from './executor.js';
import type { Notifier } from './ports.js';
import type { EngineStore, StrategyRow } from './store.js';

/** One line of the kill switch result (B11.4): what happened for one strategy's pair. */
export interface KillRow {
  pair: string;
  market: 'spot' | 'futures';
  /** Plain text, e.g. "Long 0.05 · closed". */
  what: string;
  status: 'closed' | 'cancelled' | 'failed';
}

/** The kill pass retries a failing close for this long, not the 10 minutes of a normal exit (plan S11). */
export const KILL_RETRY_MS = 15_000;

export interface KillSwitchDeps {
  store: EngineStore;
  /** Null while the engine is off (`TRADING_ENABLED` not true, or no key): strategies are still disabled. */
  executor: Executor | null;
  mutex: KeyedMutex;
  notifier: Notifier;
  now: () => number;
}

/**
 * B11: disables every strategy, cancels the orders the system placed and
 * market-closes the positions the system opened. Nothing else is touched
 * (B11.3): it only ever addresses strategy rows, their orders and their own
 * position quantity.
 */
export class KillSwitch {
  constructor(private readonly d: KillSwitchDeps) {}

  async run(): Promise<KillRow[]> {
    const rows: KillRow[] = [];
    for (const s of await this.d.store.killableStrategies()) {
      const row = await this.d.mutex.run(s.id, () => this.stop(s.id));
      if (row) rows.push(row);
    }
    if (rows.length > 0) {
      await this.d.notifier.notify('kill_switch', null, { what: rows.map((r) => `${r.pair} ${r.market} ${r.status}`).join(', ') });
    }
    return rows;
  }

  /** Stops one strategy under its mutex key; null when there was nothing but the disable to do. */
  private async stop(strategyId: string): Promise<KillRow | null> {
    const s = await this.d.store.strategy(strategyId);
    if (!s || s.status === 'closed') return null;
    await this.d.store.setStrategyStatus(s.id, 'disabled', null); // first: no new entry can start
    const ex = this.d.executor;

    if (!ex) {
      const p = await this.d.store.openPosition(s.id);
      return p ? this.row(s, `${sideLabel(p.side)} ${new Decimal(p.qty).toFixed()} · engine is off, close it on Binance`, 'failed') : null;
    }

    let cancelled = 0;
    try {
      for (const o of await this.d.store.openEntryOrders(s.id)) {
        await ex.cancelRow(o);
        cancelled++;
      }
    } catch (err) {
      return this.fail(ex, s, `Could not cancel an order: ${errText(err)}`);
    }

    const p = await this.d.store.openPosition(s.id); // after the cancels: an entry may have filled meanwhile
    if (!p) {
      try {
        for (const o of await this.d.store.openProtectiveOrders(s.id)) {
          await ex.cancelRow(o);
          cancelled++;
        }
      } catch (err) {
        return this.fail(ex, s, `Could not cancel an order: ${errText(err)}`);
      }
      return cancelled > 0 ? this.row(s, `${cancelled} order${cancelled === 1 ? '' : 's'} cancelled`, 'cancelled') : null;
    }

    const key = (await this.d.store.pendingKillKey(p.id)) ?? this.d.now();
    const pnl = await ex.exit(s, p, 'kill_switch', key, 'kill', null, KILL_RETRY_MS);
    const after = await this.d.store.strategy(s.id);
    const qty = new Decimal(p.qty).toFixed();
    if (after?.status === 'needs_attention') return this.row(s, `${sideLabel(p.side)} ${qty} · ${after.attentionReason ?? 'close failed'}`, 'failed');
    const orders = cancelled > 0 ? ` · ${cancelled} order${cancelled === 1 ? '' : 's'} cancelled` : '';
    return this.row(s, `${sideLabel(p.side)} ${qty}${orders}${pnl ? '' : ' · already flat on Binance'}`, 'closed');
  }

  private async fail(ex: Executor, s: StrategyRow, reason: string): Promise<KillRow> {
    await ex.attention(s, reason, 'order_rejected', { pair: s.pair, action: 'kill switch' });
    return this.row(s, reason, 'failed');
  }

  private row(s: StrategyRow, what: string, status: KillRow['status']): KillRow {
    return { pair: s.pair, market: s.market, what, status };
  }
}

const sideLabel = (side: string): string => (side === 'long' ? 'Long' : 'Short');
