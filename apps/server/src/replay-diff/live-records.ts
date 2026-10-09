import { Decimal } from 'decimal.js';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, notInArray, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Market, OpenPosition } from '@cane/core';
import { orders, positions, signals, strategies } from '../db/schema.js';

export interface LiveRow {
  /** Open time of the evaluated 4H candle (UTC ms). */
  key: number;
  decision: unknown;
  /** When live claimed the decision: the moment its position state applied. */
  at: Date;
}

export interface DiffStrategy {
  id: string;
  pair: string;
  market: Market;
}

/** Stop orders that never protected the position (PENDING: the send failed or never finished). */
const DEAD_STOP = ['PENDING', 'NOT_SENT', 'REJECTED'];

/**
 * Reads what live recorded, through the read-only `cane_replay` user (plan S13).
 * SELECT only: strategies, signals, positions, orders.
 */
export class LiveRecords {
  constructor(private readonly db: NodePgDatabase) {}

  /** Strategies with a 4H evaluation in [fromKey, toKey), plus any still managed. */
  async strategies(fromKey: number, toKey: number): Promise<DiffStrategy[]> {
    const evaluated = this.db
      .selectDistinct({ id: signals.strategyId })
      .from(signals)
      .where(and(eq(signals.timeframe, '4h'), gte(signals.candleOpenTime, fromKey), lt(signals.candleOpenTime, toKey)));
    return this.db
      .select({ id: strategies.id, pair: strategies.pair, market: strategies.market })
      .from(strategies)
      .where(or(inArray(strategies.id, evaluated), inArray(strategies.status, ['enabled', 'needs_attention'])))
      .orderBy(strategies.id);
  }

  /** The strategy's 4H rows with keys in [fromKey, toKey). */
  async rows(strategyId: string, fromKey: number, toKey: number): Promise<LiveRow[]> {
    const rows = await this.db
      .select({ key: signals.candleOpenTime, decision: signals.decision, at: signals.createdAt })
      .from(signals)
      .where(
        and(
          eq(signals.strategyId, strategyId),
          eq(signals.timeframe, '4h'),
          gte(signals.candleOpenTime, fromKey),
          lt(signals.candleOpenTime, toKey),
        ),
      )
      .orderBy(asc(signals.candleOpenTime));
    return rows.map((r) => ({ key: Number(r.key), decision: r.decision, at: r.at }));
  }

  /** Whether the strategy has a 4H row before `key` and one after it. */
  async hasRowsAround(strategyId: string, key: number): Promise<boolean> {
    const one = async (cond: ReturnType<typeof lt>) => {
      const [r] = await this.db
        .select({ id: signals.id })
        .from(signals)
        .where(and(eq(signals.strategyId, strategyId), eq(signals.timeframe, '4h'), cond))
        .limit(1);
      return r !== undefined;
    };
    return (await one(lt(signals.candleOpenTime, key))) && (await one(gt(signals.candleOpenTime, key)));
  }

  /**
   * The position live held at `at`, as the engine passes it to `decide`: side,
   * kind (late or primary), the stop in force (newest live stop order created
   * before `at`, else the position's stop) and the open time.
   */
  async positionAt(strategyId: string, at: Date): Promise<OpenPosition | null> {
    const [p] = await this.db
      .select()
      .from(positions)
      .where(and(eq(positions.strategyId, strategyId), lt(positions.openedAt, at), or(isNull(positions.closedAt), gt(positions.closedAt, at))))
      .orderBy(desc(positions.openedAt))
      .limit(1);
    if (!p) return null;
    const [stop] = await this.db
      .select({ stopPrice: orders.stopPrice })
      .from(orders)
      .where(and(eq(orders.positionId, p.id), eq(orders.purpose, 'stop'), lt(orders.createdAt, at), notInArray(orders.status, DEAD_STOP)))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(1);
    return {
      side: p.side,
      kind: p.entryKind === 'late' ? 'late' : 'primary',
      stop: new Decimal(stop?.stopPrice ?? p.stopPrice),
      openedAt: p.openedAt.getTime(),
    };
  }
}
