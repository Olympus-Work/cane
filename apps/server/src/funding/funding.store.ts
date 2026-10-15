import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Decimal } from 'decimal.js';
import type { FundingEvent } from '@cane/core';
import { fundingRate } from '../db/schema.js';

const UPSERT_CHUNK = 500;

type Row = typeof fundingRate.$inferSelect;

function toEvent(row: Row): FundingEvent {
  return {
    fundingTime: row.fundingTime,
    rate: new Decimal(row.rate),
    markPrice: row.markPrice === null ? null : new Decimal(row.markPrice),
    intervalHours: row.intervalHours,
  };
}

/** `funding_rate` access (plan F01). Plain queries; the interval and gap rules live in @cane/core. */
export class FundingStore {
  constructor(private readonly db: NodePgDatabase) {}

  /** Insert or replace events by (symbol, funding_time); re-running with the same rows changes nothing. */
  async upsert(symbol: string, events: readonly FundingEvent[]): Promise<void> {
    for (let i = 0; i < events.length; i += UPSERT_CHUNK) {
      const rows = events.slice(i, i + UPSERT_CHUNK).map((e) => ({
        symbol,
        fundingTime: e.fundingTime,
        rate: e.rate.toString(),
        markPrice: e.markPrice === null ? null : e.markPrice.toString(),
        intervalHours: e.intervalHours,
      }));
      await this.db
        .insert(fundingRate)
        .values(rows)
        .onConflictDoUpdate({
          target: [fundingRate.symbol, fundingRate.fundingTime],
          set: {
            rate: sql`excluded.rate`,
            markPrice: sql`excluded.mark_price`,
            intervalHours: sql`excluded.interval_hours`,
          },
        });
    }
  }

  async newest(symbol: string): Promise<FundingEvent | null> {
    const [row] = await this.db
      .select()
      .from(fundingRate)
      .where(eq(fundingRate.symbol, symbol))
      .orderBy(desc(fundingRate.fundingTime))
      .limit(1);
    return row ? toEvent(row) : null;
  }

  async oldest(symbol: string): Promise<FundingEvent | null> {
    const [row] = await this.db
      .select()
      .from(fundingRate)
      .where(eq(fundingRate.symbol, symbol))
      .orderBy(asc(fundingRate.fundingTime))
      .limit(1);
    return row ? toEvent(row) : null;
  }

  /** Events with `from <= funding_time <= to`, ascending. */
  async range(symbol: string, from: number, to: number): Promise<FundingEvent[]> {
    const rows = await this.db
      .select()
      .from(fundingRate)
      .where(and(eq(fundingRate.symbol, symbol), gte(fundingRate.fundingTime, from), lte(fundingRate.fundingTime, to)))
      .orderBy(asc(fundingRate.fundingTime));
    return rows.map(toEvent);
  }
}
