import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Decimal } from 'decimal.js';
import { sizePct, targetNotional, type Market } from '@cane/core';
import { AuditService } from '../audit/audit.service.js';
import { FreshTotpGuard, SessionGuard } from '../auth/guards.js';
import { ctxOf, type AuthedRequest } from '../auth/http.js';
import { DB } from '../db/db.module.js';
import { orders, positions, strategies, MARKETS, SIZING_MODES } from '../db/schema.js';
import { OPEN_STATUSES, PENDING } from '../engine/store.js';
import { ExchangeStateService } from '../exchange/exchange-state.service.js';
import { EXCHANGE_READER, ExchangeReadError, tickerKey, type ExchangeReader } from '../exchange/exchange-reader.js';
import { StatsService } from '../stats/stats.service.js';
import { parseCreate, parsePatch, validateFields, type StrategyFields } from './strategy-input.js';

const UNIQUE_VIOLATION = '23505';
const PNL_DAYS = 30;
const ID_LOCK = 950_001; // serialises id allocation: pg_advisory_xact_lock key
/** Fields Binance will not let change under an open position (B10.7, B9.4). */
const LOCKED_WITH_POSITION = ['pair', 'market', 'leverage', 'marginMode'] as const;

/** Drizzle wraps the driver error, so the Postgres code can sit on `cause`. */
const pgCode = (e: unknown): string | undefined => (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;

type StrategyRow = typeof strategies.$inferSelect;
type PositionRow = typeof positions.$inferSelect;

const fieldsOf = (s: StrategyRow): StrategyFields => ({
  pair: s.pair,
  market: s.market,
  leverage: s.leverage,
  sizingMode: s.sizingMode,
  marginMode: s.marginMode,
  basePct: new Decimal(s.basePct).toFixed(),
  confidenceThreshold: new Decimal(s.confidenceThreshold).toFixed(),
  riskPct: s.riskPct === null ? null : new Decimal(s.riskPct).toFixed(),
});

/** Strategies (B10). Enable / disable need fresh TOTP or a session as in S08; close of a strategy with a position waits for S11. */
@Controller('v1/strategies')
@UseGuards(SessionGuard)
export class StrategiesController {
  constructor(
    @Inject(DB) private readonly db: NodePgDatabase,
    private readonly audit: AuditService,
    private readonly exchange: ExchangeStateService,
    @Inject(EXCHANGE_READER) private readonly reader: ExchangeReader,
    private readonly stats: StatsService,
  ) {}

  /** B10.8: the list with price, position, state and 30-day PnL. Closed strategies last. */
  @Get()
  async list() {
    const rows = await this.db
      .select()
      .from(strategies)
      .orderBy(sql`(${strategies.status} = 'closed')`, asc(strategies.id));
    const open = await this.db.select().from(positions).where(eq(positions.status, 'open'));
    const openByStrategy = new Map(open.map((p) => [p.strategyId, p]));
    const [view, pnl] = await Promise.all([this.exchange.view(), this.stats.dailyPnlByStrategy(rows.map((r) => r.id), PNL_DAYS, Date.now())]);
    const items = rows.map((s) => {
      const ticker = view.snapshot?.tickers[tickerKey(s.market, s.pair)];
      const p = openByStrategy.get(s.id);
      return {
        id: s.id,
        pair: s.pair,
        market: s.market,
        status: s.status,
        attentionReason: s.attentionReason,
        sizingMode: s.sizingMode,
        marginMode: s.marginMode,
        leverageCeiling: s.leverage,
        leverageInUse: p?.leverage ?? null,
        basePct: new Decimal(s.basePct).toFixed(),
        confidenceThreshold: new Decimal(s.confidenceThreshold).toFixed(),
        riskPct: s.riskPct === null ? null : new Decimal(s.riskPct).toFixed(),
        price: ticker?.price ?? null,
        change24hPct: ticker?.changePct ?? null,
        position: p ? positionSummary(p, ticker?.price ?? null, view.snapshot?.futuresPositions.find((f) => f.pair === p.pair)?.unrealizedPnl ?? null) : null,
        /** B10.7: pair, market, leverage and margin mode cannot be edited while true. */
        locked: p !== undefined,
        pnl30d: pnl.get(s.id) ?? { total: '0', daily: [] },
      };
    });
    return { items, lastSyncAt: view.lastSyncAt, stale: view.stale, exchangeError: view.error };
  }

  /** B10.1 live sizing preview from current equity: base only, 2 factors, 3 factors. Mode C needs a stop, so it has no amounts. */
  @Get('sizing-preview')
  async preview(@Query('market') marketQ?: string, @Query('sizingMode') modeQ?: string, @Query('basePct') basePctQ?: string, @Query('leverage') leverageQ?: string) {
    const market = (marketQ ?? 'futures') as Market;
    const mode = (modeQ ?? 'B') as (typeof SIZING_MODES)[number];
    if (!MARKETS.includes(market)) throw new BadRequestException({ code: 'bad_market', message: 'market must be spot or futures' });
    if (!SIZING_MODES.includes(mode)) throw new BadRequestException({ code: 'bad_sizingMode', message: 'sizingMode must be A, B or C' });
    const leverage = market === 'spot' ? 1 : Number(leverageQ ?? 5);
    const f = validateFields({
      pair: 'BTCUSDT',
      market,
      leverage: market === 'spot' ? null : leverage,
      sizingMode: mode,
      marginMode: market === 'spot' ? null : 'isolated',
      basePct: parsePatch({ basePct: basePctQ ?? 10 }).basePct ?? '10',
      confidenceThreshold: '0.70',
      riskPct: mode === 'C' ? '2' : null,
    });
    const view = await this.exchange.view();
    const equity = view.snapshot ? new Decimal(market === 'spot' ? view.snapshot.spotEquity : view.snapshot.futuresEquity) : null;
    const rows = [0, 2, 3].map((factors) => {
      const pct = sizePct(new Decimal(f.basePct), factors);
      const amounts =
        equity && mode !== 'C'
          ? targetNotional({ mode, sizePct: pct, equity, leverage: market === 'spot' ? 1 : leverage, entryPrice: new Decimal(1), stop: new Decimal(0) })
          : null;
      return { factors, sizePct: pct.toFixed(), notional: amounts?.notional.toFixed() ?? null, margin: amounts?.margin.toFixed() ?? null };
    });
    return { market, sizingMode: mode, equity: equity?.toFixed() ?? null, stale: view.stale, exchangeError: view.error, rows };
  }

  /** B10.1: creates `S-NN`, always `disabled`. */
  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown, @Req() req: AuthedRequest) {
    const f = parseCreate(body);
    await this.requireListed(f.market, f.pair);
    const row = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${ID_LOCK})`);
      const next = ((await tx.execute(sql`select coalesce(max(substr(id, 3)::int), 0) + 1 as next from strategies`)).rows as { next: number }[])[0]?.next ?? 1;
      const [created] = await tx
        .insert(strategies)
        .values({ id: `S-${String(next).padStart(2, '0')}`, ...f })
        .returning();
      if (!created) throw new Error('strategy insert returned no row');
      return created;
    });
    await this.audit.record({ actor: 'owner', action: 'strategy_create', target: row.id, after: f, ip: ctxOf(req).ip });
    return { id: row.id, status: row.status };
  }

  /** B10.7: with an open position, pair, market, leverage and margin mode are locked; the rest applies to the next entry. */
  @Patch(':id')
  async edit(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const patch = parsePatch(body);
    const s = await this.load(id);
    const before = fieldsOf(s);
    const merged = validateFields({ ...before, ...patch });
    const [position] = await this.db.select({ id: positions.id }).from(positions).where(and(eq(positions.strategyId, id), eq(positions.status, 'open')));
    if (position) {
      for (const field of LOCKED_WITH_POSITION) {
        if (patch[field] !== undefined && patch[field] !== before[field]) {
          throw new ConflictException({ code: 'locked_field', field, message: `${field} cannot change while the strategy has an open position` });
        }
      }
    }
    const pairChanged = merged.pair !== before.pair || merged.market !== before.market;
    if (pairChanged && s.status !== 'disabled') {
      throw new ConflictException({ code: 'disable_first', message: 'Disable the strategy before changing its pair or market' });
    }
    if (pairChanged) await this.requireListed(merged.market, merged.pair);
    try {
      await this.db.update(strategies).set({ ...merged, updatedAt: new Date() }).where(eq(strategies.id, id));
    } catch (e) {
      if (pgCode(e) !== UNIQUE_VIOLATION) throw e;
      throw new ConflictException({ code: 'pair_in_use', message: `${merged.pair} is already used by another strategy` });
    }
    await this.audit.record({ actor: 'owner', action: 'strategy_edit', target: id, before, after: merged, ip: ctxOf(req).ip });
    return { id, ...merged };
  }

  /**
   * B10.5 for a strategy with nothing open: mark it `closed`, history kept.
   * With an open position or live orders the market close and order cancels
   * belong to the kill-switch step (S11), so this answers 409 instead.
   */
  @Post(':id/close')
  @HttpCode(200)
  async close(@Param('id') id: string, @Req() req: AuthedRequest) {
    const s = await this.load(id);
    // Mark it closed first, then look for anything live and roll back if found: an engine tick that
    // starts after the update no longer sees an enabled strategy, so nothing slips in behind the check.
    await this.db.transaction(async (tx) => {
      await tx.update(strategies).set({ status: 'closed', attentionReason: null, updatedAt: new Date() }).where(eq(strategies.id, id));
      const [position] = await tx.select({ id: positions.id }).from(positions).where(and(eq(positions.strategyId, id), eq(positions.status, 'open')));
      if (position) throw new ConflictException({ code: 'position_open', message: 'Close the open position first' });
      const [live] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.strategyId, id), inArray(orders.status, [PENDING, ...OPEN_STATUSES])));
      if (live) throw new ConflictException({ code: 'orders_open', message: 'The strategy still has live orders' });
    });
    await this.audit.record({ actor: 'owner', action: 'strategy_close', target: id, before: { status: s.status }, after: { status: 'closed' }, ip: ctxOf(req).ip });
    return { id, status: 'closed' };
  }

  /** B10.3 (fresh TOTP) and B10.2 (one active strategy per pair). */
  @Post(':id/enable')
  @HttpCode(200)
  @UseGuards(FreshTotpGuard)
  async enable(@Param('id') id: string, @Req() req: AuthedRequest) {
    const s = await this.load(id);
    if (s.status === 'enabled') return { id, status: s.status };
    try {
      await this.db.update(strategies).set({ status: 'enabled', attentionReason: null, updatedAt: new Date() }).where(eq(strategies.id, id));
    } catch (e) {
      if (pgCode(e) !== UNIQUE_VIOLATION) throw e;
      const [other] = await this.db
        .select({ id: strategies.id })
        .from(strategies)
        .where(and(eq(strategies.pair, s.pair), inArray(strategies.status, ['enabled', 'needs_attention']), ne(strategies.id, id)));
      throw new ConflictException(`${s.pair} is already used by ${other?.id ?? 'another strategy'}`);
    }
    await this.audit.record({ actor: 'owner', action: 'strategy_enable', target: id, before: { status: s.status }, after: { status: 'enabled' }, ip: ctxOf(req).ip });
    return { id, status: 'enabled' };
  }

  /** B10.4: no new entries; an open position stays managed. Needs a session only. */
  @Post(':id/disable')
  @HttpCode(200)
  async disable(@Param('id') id: string, @Req() req: AuthedRequest) {
    const s = await this.load(id);
    if (s.status === 'disabled') return { id, status: s.status };
    await this.db.update(strategies).set({ status: 'disabled', updatedAt: new Date() }).where(eq(strategies.id, id));
    await this.audit.record({ actor: 'owner', action: 'strategy_disable', target: id, before: { status: s.status }, after: { status: 'disabled' }, ip: ctxOf(req).ip });
    return { id, status: 'disabled' };
  }

  private async load(id: string): Promise<StrategyRow> {
    const [s] = await this.db.select().from(strategies).where(eq(strategies.id, id));
    if (!s || s.status === 'closed') throw new NotFoundException('No such strategy');
    return s;
  }

  /** B10.6: only USDT pairs that are listed and TRADING on the chosen market. */
  private async requireListed(market: Market, pair: string): Promise<void> {
    let listed: boolean;
    try {
      listed = await this.reader.isListed(market, pair);
    } catch (e) {
      if (e instanceof ExchangeReadError) throw new ServiceUnavailableException({ code: 'exchange_unreachable', message: 'Binance cannot be reached to check the pair' });
      throw e;
    }
    if (!listed) throw new BadRequestException({ code: 'pair_not_listed', message: `${pair} is not a USDT pair listed on ${market}` });
  }
}

/** Unrealised PnL: the exchange's figure for futures, price x qty for spot; null when no price is known. */
function positionSummary(p: PositionRow, price: string | null, futuresUnrealised: string | null) {
  let unrealizedPnl: string | null = null;
  if (p.market === 'futures') unrealizedPnl = futuresUnrealised;
  else if (price !== null) unrealizedPnl = new Decimal(price).minus(p.entryPrice).times(p.qty).toFixed();
  return {
    side: p.side,
    qty: new Decimal(p.qty).toFixed(),
    entryPrice: new Decimal(p.entryPrice).toFixed(),
    stopPrice: new Decimal(p.stopPrice).toFixed(),
    takeProfitPrice: p.takeProfitPrice === null ? null : new Decimal(p.takeProfitPrice).toFixed(),
    leverage: p.leverage,
    openedAt: p.openedAt.toISOString(),
    unrealizedPnl,
  };
}
