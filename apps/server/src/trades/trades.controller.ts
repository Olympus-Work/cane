import { Controller, Get, Inject, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { desc, eq, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Decimal } from 'decimal.js';
import { FACTOR_NAMES } from '@cane/core';
import { SessionGuard } from '../auth/guards.js';
import { DB } from '../db/db.module.js';
import { jevCalls, strategies, trades } from '../db/schema.js';
import { parse as parseJevBody } from '../jev/jev.client.js';
import { parseBefore, parseLimit } from '../paging.js';

type TradeRow = typeof trades.$inferSelect;

const dec = (v: string): string => new Decimal(v).toFixed();

/** B16.5: the history row. */
const summary = (t: TradeRow) => ({
  id: t.id,
  strategyId: t.strategyId,
  pair: t.pair,
  market: t.market,
  side: t.side,
  entryPrice: dec(t.entryPrice),
  exitPrice: dec(t.exitPrice),
  qty: dec(t.qty),
  netPnl: dec(t.netPnl),
  exitReason: t.exitReason,
  openedAt: t.openedAt.toISOString(),
  closedAt: t.closedAt.toISOString(),
});

/** Trade history and trade detail (B16.5, B16.6). Newest first, paged by id. */
@Controller('v1/trades')
@UseGuards(SessionGuard)
export class TradesController {
  constructor(@Inject(DB) private readonly db: NodePgDatabase) {}

  @Get()
  async list(@Query('limit') limitQ?: string, @Query('before') beforeQ?: string) {
    const limit = parseLimit(limitQ);
    const before = parseBefore(beforeQ);
    const rows = await this.db
      .select()
      .from(trades)
      .where(before === undefined ? undefined : lt(trades.id, before))
      .orderBy(desc(trades.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return { items: page.map(summary), nextBefore: rows.length > limit ? page[page.length - 1]?.id ?? null : null };
  }

  @Get(':id')
  async detail(@Param('id') idParam: string) {
    const id = Number(idParam);
    if (!Number.isInteger(id) || id < 1) throw new NotFoundException('No such trade');
    const [t] = await this.db.select().from(trades).where(eq(trades.id, id));
    if (!t) throw new NotFoundException('No such trade');
    const [strategy] = await this.db.select({ confidenceThreshold: strategies.confidenceThreshold }).from(strategies).where(eq(strategies.id, t.strategyId));
    const [jev] = t.jevCallId === null ? [] : await this.db.select().from(jevCalls).where(eq(jevCalls.id, t.jevCallId));
    const threshold = strategy ? dec(strategy.confidenceThreshold) : null;
    const parsed = jev && !jev.fallback ? parseJevBody(jev.response, t.side) : null;
    const factors = parsed
      ? parsed.factors.map((f, i) => ({
          name: FACTOR_NAMES[t.side][i] ?? '',
          confidence: f.confidence,
          present: f.present,
          /** True when it also cleared the strategy threshold, i.e. it grew the position (B6.1). */
          counted: f.present && threshold !== null && new Decimal(f.confidence).gte(threshold),
        }))
      : null;
    return {
      ...summary(t),
      entryKind: t.entryKind,
      signalTimeframe: t.signalTimeframe,
      trend1w: t.trend1w,
      factors,
      threshold,
      jevFallback: t.jevFallback,
      sizingMode: t.sizingMode,
      sizePct: dec(t.sizePct),
      leverage: { configured: t.leverageConfigured, used: t.leverageUsed, lowered: t.leverageConfigured !== null && t.leverageUsed !== null && t.leverageUsed < t.leverageConfigured },
      pnl: { gross: dec(t.grossPnl), fees: dec(t.fees), funding: dec(t.funding), net: dec(t.netPnl) },
    };
  }
}
