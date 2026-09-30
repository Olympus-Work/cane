import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Decimal } from 'decimal.js';
import { DB } from '../db/db.module.js';

const DAY_MS = 86_400_000;
const ICT_OFFSET_MS = 7 * 3_600_000; // Asia/Bangkok has no daylight saving

/** The Asia/Bangkok calendar day (`YYYY-MM-DD`) of a UTC millisecond time (B16.8: day boundary 00:00 ICT). */
export const bangkokDay = (ms: number): string => new Date(ms + ICT_OFFSET_MS).toISOString().slice(0, 10);

/** The `count` Bangkok days ending at `nowMs`'s day, oldest first. */
export function bangkokDays(nowMs: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => bangkokDay(nowMs - (count - 1 - i) * DAY_MS));
}

export interface DailyPnl {
  day: string;
  pnl: string;
}

export interface HeatDay {
  day: string;
  trades: number;
  wins: number;
  losses: number;
  pnl: string;
  /** 0 / 1 / 2 / 3 for that many trades, 4 for four or more (B16.8). */
  level: 0 | 1 | 2 | 3 | 4;
}

export const heatLevel = (trades: number): HeatDay['level'] => Math.min(trades, 4) as HeatDay['level'];

/**
 * Realised-PnL reports over `trades` (B10.8, B16.2, B16.8). Days are Bangkok
 * days; grouping and summing happen in SQL on `numeric`, so no money passes
 * through JS number arithmetic.
 */
@Injectable()
export class StatsService {
  constructor(@Inject(DB) private readonly db: NodePgDatabase) {}

  /** Daily net PnL per strategy for the last `days` Bangkok days, zero-filled, oldest first. */
  async dailyPnlByStrategy(strategyIds: string[], days: number, nowMs: number): Promise<Map<string, { total: string; daily: DailyPnl[] }>> {
    const list = bangkokDays(nowMs, days);
    const rows = await this.rows<{ strategy_id: string; day: string; pnl: string }>(sql`
      select strategy_id, to_char(closed_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD') as day, sum(net_pnl)::text as pnl
      from trades
      where to_char(closed_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD') >= ${list[0]}
        and to_char(closed_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD') <= ${list[list.length - 1]}
      group by strategy_id, day`);
    const byStrategy = new Map<string, Map<string, string>>();
    for (const r of rows) {
      const m = byStrategy.get(r.strategy_id) ?? new Map<string, string>();
      m.set(r.day, r.pnl);
      byStrategy.set(r.strategy_id, m);
    }
    const out = new Map<string, { total: string; daily: DailyPnl[] }>();
    for (const id of strategyIds) {
      const m = byStrategy.get(id) ?? new Map<string, string>();
      const daily = list.map((day) => ({ day, pnl: new Decimal(m.get(day) ?? 0).toFixed() }));
      const total = daily.reduce((sum, d) => sum.plus(d.pnl), new Decimal(0)).toFixed();
      out.set(id, { total, daily });
    }
    return out;
  }

  /** B16.2: today's (Bangkok day) and total realised PnL and the number of closed trades. */
  async realised(nowMs: number): Promise<{ today: string; total: string; trades: number }> {
    const today = bangkokDay(nowMs);
    const [r] = await this.rows<{ today: string; total: string; trades: string }>(sql`
      select coalesce(sum(net_pnl) filter (where to_char(closed_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD') = ${today}), 0)::text as today,
             coalesce(sum(net_pnl), 0)::text as total,
             count(*)::text as trades
      from trades`);
    return { today: r?.today ?? '0', total: r?.total ?? '0', trades: Number(r?.trades ?? 0) };
  }

  /** B16.8: one row per Bangkok day that has a trade, within the last `days` days. */
  async heatmap(days: number, nowMs: number): Promise<HeatDay[]> {
    const list = bangkokDays(nowMs, days);
    const rows = await this.rows<{ day: string; trades: string; wins: string; losses: string; pnl: string }>(sql`
      select to_char(closed_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD') as day,
             count(*)::text as trades,
             (count(*) filter (where net_pnl > 0))::text as wins,
             (count(*) filter (where net_pnl < 0))::text as losses,
             sum(net_pnl)::text as pnl
      from trades
      where to_char(closed_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD') >= ${list[0]}
        and to_char(closed_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD') <= ${list[list.length - 1]}
      group by day
      order by day`);
    return rows.map((r) => ({ day: r.day, trades: Number(r.trades), wins: Number(r.wins), losses: Number(r.losses), pnl: r.pnl, level: heatLevel(Number(r.trades)) }));
  }

  private async rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
    return (await this.db.execute(query)).rows as T[];
  }
}
