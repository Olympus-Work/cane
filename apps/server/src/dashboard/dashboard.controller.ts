import { BadRequestException, Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { and, eq, gte, inArray, max } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Decimal } from 'decimal.js';
import { SessionGuard } from '../auth/guards.js';
import { DB } from '../db/db.module.js';
import { auditLog, jevCalls, positions, strategies } from '../db/schema.js';
import { ExchangeStateService } from '../exchange/exchange-state.service.js';
import { tickerKey } from '../exchange/exchange-reader.js';
import { StatsService } from '../stats/stats.service.js';

const JEV_FALLBACK_WINDOW_MS = 24 * 3_600_000; // B16.3 "Jev fallback used": last 24 h (plan S09.5)
const HEATMAP_DEFAULT_DAYS = 365;
const HEATMAP_MAX_DAYS = 400;

export type DashboardAlert =
  | { kind: 'needs_attention'; strategyId: string; pair: string; reason: string | null; link: 'strategies' }
  | { kind: 'jev_fallback'; count: number; link: 'trades' }
  | { kind: 'exchange_unreachable'; link: 'settings' }
  | { kind: 'key_error'; link: 'settings' };

/** Dashboard data (B16.1–16.4, B16.8). Values are decimal strings; stale snapshots are flagged, never hidden (B16.9). */
@Controller('v1/dashboard')
@UseGuards(SessionGuard)
export class DashboardController {
  constructor(
    @Inject(DB) private readonly db: NodePgDatabase,
    private readonly exchange: ExchangeStateService,
    private readonly stats: StatsService,
  ) {}

  @Get()
  async overview() {
    const now = Date.now();
    const [view, realised, open, attention, fallbacks] = await Promise.all([
      this.exchange.view(),
      this.stats.realised(now),
      this.db.select().from(positions).where(eq(positions.status, 'open')),
      this.db.select({ id: strategies.id, pair: strategies.pair, reason: strategies.attentionReason }).from(strategies).where(eq(strategies.status, 'needs_attention')),
      this.db.select({ id: jevCalls.id }).from(jevCalls).where(and(eq(jevCalls.fallback, true), gte(jevCalls.createdAt, new Date(now - JEV_FALLBACK_WINDOW_MS)))),
    ]);
    const snap = view.snapshot;
    const killed = await this.killedSwitch();

    const alerts: DashboardAlert[] = attention.map((s) => ({ kind: 'needs_attention', strategyId: s.id, pair: s.pair, reason: s.reason, link: 'strategies' }));
    if (fallbacks.length > 0) alerts.push({ kind: 'jev_fallback', count: fallbacks.length, link: 'trades' });
    if (view.error === 'unreachable') alerts.push({ kind: 'exchange_unreachable', link: 'settings' });
    if (view.error === 'no_key' || view.error === 'key_rejected') alerts.push({ kind: 'key_error', link: 'settings' });

    const stratOf = new Map(
      (open.length === 0 ? [] : await this.db.select({ id: strategies.id, sizingMode: strategies.sizingMode }).from(strategies).where(inArray(strategies.id, open.map((p) => p.strategyId)))).map((s) => [s.id, s.sizingMode]),
    );
    const positionRows = open.map((p) => {
      const ticker = snap?.tickers[tickerKey(p.market, p.pair)];
      const fut = p.market === 'futures' ? snap?.futuresPositions.find((f) => f.pair === p.pair) : undefined;
      const mark = fut?.markPrice ?? ticker?.price ?? null;
      const dir = p.side === 'long' ? 1 : -1;
      const unrealizedPnl = fut ? fut.unrealizedPnl : mark === null ? null : new Decimal(mark).minus(p.entryPrice).times(p.qty).times(dir).toFixed();
      const cost = new Decimal(p.entryPrice).times(p.qty);
      return {
        strategyId: p.strategyId,
        sizingMode: stratOf.get(p.strategyId) ?? null,
        pair: p.pair,
        market: p.market,
        side: p.side,
        qty: new Decimal(p.qty).toFixed(),
        entryPrice: new Decimal(p.entryPrice).toFixed(),
        markPrice: mark,
        change24hPct: ticker?.changePct ?? null,
        unrealizedPnl,
        /** Percent of the position's entry value (price move, not margin), null without a mark. */
        unrealizedPnlPct: unrealizedPnl === null || cost.isZero() ? null : new Decimal(unrealizedPnl).div(cost).times(100).toFixed(2),
        stopPrice: new Decimal(p.stopPrice).toFixed(),
        takeProfitPrice: p.takeProfitPrice === null ? null : new Decimal(p.takeProfitPrice).toFixed(),
        liquidationPrice: fut?.liquidationPrice ?? null,
        leverage: p.leverage,
        openedAt: p.openedAt.toISOString(),
      };
    });

    return {
      status: killed ? 'stopped_by_kill_switch' : view.error === 'unreachable' ? 'exchange_unreachable' : 'running',
      lastSyncAt: view.lastSyncAt,
      stale: view.stale,
      cards: {
        spotEquity: snap?.spotEquity ?? null,
        futuresEquity: snap?.futuresEquity ?? null,
        realisedToday: new Decimal(realised.today).toFixed(),
        realisedTotal: new Decimal(realised.total).toFixed(),
        tradeCount: realised.trades,
        openPositions: { spot: open.filter((p) => p.market === 'spot').length, futures: open.filter((p) => p.market === 'futures').length },
      },
      alerts,
      positions: positionRows,
    };
  }

  /**
   * B11.5: trading is stopped from a kill switch until the first strategy is
   * enabled again. Derived from the audit trail (newest kill row newer than the
   * newest enable row), so it survives restarts without a new table.
   */
  private async killedSwitch(): Promise<boolean> {
    const rows = await this.db
      .select({ action: auditLog.action, last: max(auditLog.id) })
      .from(auditLog)
      .where(inArray(auditLog.action, ['kill_switch', 'strategy_enable']))
      .groupBy(auditLog.action);
    const last = (action: string) => rows.find((r) => r.action === action)?.last ?? 0;
    return last('kill_switch') > last('strategy_enable');
  }

  /** B16.8: days with at least one trade; the web app fills the empty days. Day boundary 00:00 Asia/Bangkok. */
  @Get('heatmap')
  async heatmap(@Query('days') daysQ?: string) {
    const days = daysQ === undefined ? HEATMAP_DEFAULT_DAYS : Number(daysQ);
    if (!Number.isInteger(days) || days < 1 || days > HEATMAP_MAX_DAYS) throw new BadRequestException({ code: 'bad_days', message: `days must be 1-${HEATMAP_MAX_DAYS}` });
    return { days, items: (await this.stats.heatmap(days, Date.now())).map((d) => ({ ...d, pnl: new Decimal(d.pnl).toFixed() })) };
  }
}
