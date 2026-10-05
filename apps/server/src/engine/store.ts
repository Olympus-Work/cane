import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { auditLog, jevCalls, orders, positions, signals, strategies, trades } from '../db/schema.js';

export type StrategyRow = typeof strategies.$inferSelect;
export type PositionRow = typeof positions.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type NewPosition = typeof positions.$inferInsert;
export type NewTrade = typeof trades.$inferInsert;
export type NewJevCall = typeof jevCalls.$inferInsert;

/** Our own order status before Binance has answered (written before the send, E1 / AC6). */
export const PENDING = 'PENDING';
/** A PENDING order Binance never received (process died before the send). */
export const NOT_SENT = 'NOT_SENT';
/** Statuses of protective orders that still protect the position. */
export const OPEN_STATUSES = ['NEW', 'PARTIALLY_FILLED', 'EXECUTING'];

/** DB access for the engine and reconciler. Plain queries; no trading rules here. */
export class EngineStore {
  constructor(private readonly db: NodePgDatabase) {}

  /**
   * Strategies the engine looks at: enabled ones, ones needing attention
   * (positions still managed, no new entries — B12.2), and disabled ones that
   * still hold a position (B10.4).
   */
  async managedStrategies(): Promise<StrategyRow[]> {
    const withOpen = this.db.select({ id: positions.strategyId }).from(positions).where(eq(positions.status, 'open'));
    return this.db
      .select()
      .from(strategies)
      .where(or(inArray(strategies.status, ['enabled', 'needs_attention']), inArray(strategies.id, withOpen)))
      .orderBy(strategies.id);
  }

  async strategy(id: string): Promise<StrategyRow | null> {
    const [row] = await this.db.select().from(strategies).where(eq(strategies.id, id));
    return row ?? null;
  }

  /**
   * B1.2: records one evaluation per strategy + timeframe + candle. Returns
   * the new signal id, or null if that key was already taken.
   */
  async claimSignal(strategyId: string, timeframe: '4h' | '1d' | '1w', candleOpenTime: number, decision: unknown): Promise<number | null> {
    const rows = await this.db
      .insert(signals)
      .values({ strategyId, timeframe, candleOpenTime, decision })
      .onConflictDoNothing()
      .returning({ id: signals.id });
    return rows[0]?.id ?? null;
  }

  /** Adds keys to a signal's decision JSON (e.g. the entry plan, before the order is sent). */
  async annotateSignal(signalId: number, patch: Record<string, unknown>): Promise<void> {
    await this.db
      .update(signals)
      .set({ decision: sql`${signals.decision} || ${JSON.stringify(patch)}::jsonb` })
      .where(eq(signals.id, signalId));
  }

  async signalDecision(signalId: number): Promise<unknown> {
    const [row] = await this.db.select({ decision: signals.decision }).from(signals).where(eq(signals.id, signalId));
    return row?.decision ?? null;
  }

  async openPosition(strategyId: string): Promise<PositionRow | null> {
    const [row] = await this.db
      .select()
      .from(positions)
      .where(and(eq(positions.strategyId, strategyId), eq(positions.status, 'open')));
    return row ?? null;
  }

  async insertPosition(row: NewPosition): Promise<PositionRow> {
    const [created] = await this.db.insert(positions).values(row).returning();
    return created!;
  }

  async updatePosition(id: number, patch: Partial<NewPosition>): Promise<void> {
    await this.db.update(positions).set({ ...patch, updatedAt: sql`now()` }).where(eq(positions.id, id));
  }

  async insertOrder(row: NewOrder): Promise<OrderRow> {
    const [created] = await this.db.insert(orders).values(row).returning();
    return created!;
  }

  async updateOrder(clientOrderId: string, patch: Partial<NewOrder>): Promise<void> {
    await this.db.update(orders).set({ ...patch, updatedAt: sql`now()` }).where(eq(orders.clientOrderId, clientOrderId));
  }

  async orderByClientId(clientOrderId: string): Promise<OrderRow | null> {
    const [row] = await this.db.select().from(orders).where(eq(orders.clientOrderId, clientOrderId));
    return row ?? null;
  }

  /** The entry order of a position. */
  async entryOrder(positionId: number): Promise<OrderRow | null> {
    const [row] = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.positionId, positionId), eq(orders.purpose, 'entry')));
    return row ?? null;
  }

  /** Exit orders of a position that were sent (or written before a send) but not yet booked. */
  async unbookedExits(positionId: number): Promise<OrderRow[]> {
    return this.db
      .select()
      .from(orders)
      .where(and(eq(orders.positionId, positionId), eq(orders.purpose, 'exit'), inArray(orders.status, [PENDING, 'FILLED'])));
  }

  /** B8.5: every Jev call is stored with its request and response (or failure). */
  async insertJevCall(row: NewJevCall): Promise<number> {
    const [created] = await this.db.insert(jevCalls).values(row).returning({ id: jevCalls.id });
    return created!.id;
  }

  /** Entry orders written before the send whose outcome was never recorded (AC6). */
  async pendingEntries(strategyId: string): Promise<OrderRow[]> {
    return this.db
      .select()
      .from(orders)
      .where(and(eq(orders.strategyId, strategyId), eq(orders.purpose, 'entry'), eq(orders.status, PENDING)));
  }

  /** Stop / take-profit orders of a position that are (as far as the DB knows) still open. */
  async protectiveOrders(positionId: number): Promise<OrderRow[]> {
    return this.db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.positionId, positionId),
          inArray(orders.purpose, ['stop', 'take_profit']),
          inArray(orders.status, [...OPEN_STATUSES, PENDING]),
        ),
      );
  }

  async insertTrade(row: NewTrade): Promise<void> {
    await this.db.insert(trades).values(row);
  }

  /** B11: every strategy the kill switch must stop (all but the closed ones). */
  async killableStrategies(): Promise<StrategyRow[]> {
    return this.db.select().from(strategies).where(sql`${strategies.status} <> 'closed'`).orderBy(strategies.id);
  }

  /** Entry orders of a strategy that are still open or not yet answered (B11.2: "cancel all orders the system placed"). */
  async openEntryOrders(strategyId: string): Promise<OrderRow[]> {
    return this.db
      .select()
      .from(orders)
      .where(and(eq(orders.strategyId, strategyId), eq(orders.purpose, 'entry'), inArray(orders.status, [...OPEN_STATUSES, PENDING])));
  }

  /** Open stop / take-profit orders of a strategy (all of them, with or without a position row). */
  async openProtectiveOrders(strategyId: string): Promise<OrderRow[]> {
    return this.db
      .select()
      .from(orders)
      .where(and(eq(orders.strategyId, strategyId), inArray(orders.purpose, ['stop', 'take_profit']), inArray(orders.status, [...OPEN_STATUSES, PENDING])));
  }

  /** Key of an earlier kill close that was written but never answered, so a second press reuses its client order ID. */
  async pendingKillKey(positionId: number): Promise<number | null> {
    for (const o of await this.unbookedExits(positionId)) {
      const m = /-(\d+)-kill$/.exec(o.clientOrderId);
      if (m && o.status === PENDING) return Number(m[1]);
    }
    return null;
  }

  async setStrategyStatus(id: string, status: 'disabled' | 'enabled' | 'needs_attention', reason: string | null): Promise<void> {
    await this.db.update(strategies).set({ status, attentionReason: reason, updatedAt: sql`now()` }).where(eq(strategies.id, id));
  }

  async audit(action: string, target: string, after: unknown): Promise<void> {
    await this.db.insert(auditLog).values({ actor: 'system', action, target, after });
  }
}
