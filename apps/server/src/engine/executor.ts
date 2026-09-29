import { Logger } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import {
  clientOrderId,
  planEntry,
  presentFactorCount,
  roundDownToStep,
  roundToTick,
  type EntryPlanEvent,
  type LeverageBracket,
  type OrderAction,
  type Regime,
  type Side,
  type Timeframe,
} from '@cane/core';
import type { BinanceMarket } from '../binance/endpoints.js';
import { BinanceError } from '../binance/rest.client.js';
import { TradingDisabledError, type BinanceTrading, type ExitResult, type OrderRef, type OrderState } from '../binance/trading.js';
import { futuresPnl, spotPnl, type TradePnl } from './pnl.js';
import type { JevCall, Notifier, NotifyEvent } from './ports.js';
import { PENDING, type EngineStore, type OrderRow, type PositionRow, type StrategyRow } from './store.js';

/** What to open: a decided entry (B3/B4) or a flip (B7.5). */
export interface EntryIntent {
  /** Open time of the evaluated 4H candle: the time part of every client order ID of this evaluation. */
  key: number;
  signalId: number;
  side: Side;
  kind: 'primary' | 'late' | 'flip';
  signalTimeframe: Timeframe;
  signalOpenTime: number;
  refPrice: Decimal;
  stop: Decimal;
  takeProfit: Decimal | null;
  trend1w: Regime;
  /** Jev answer for this side, or null when none is used (late entries, B4.4). */
  jev: JevCall | null;
}

/** The planned entry as written to the signal before the send, so the reconciler can finish it (AC6). */
export interface PlannedEntry {
  key: number;
  side: Side;
  kind: 'primary' | 'late' | 'flip';
  signalTimeframe: Timeframe;
  signalOpenTime: number;
  stop: string;
  takeProfit: string | null;
  trend1w: Regime;
  sizePct: string;
  leverage: number | null;
  leverageCeiling: number | null;
  presentFactors: number;
  jevCallId: number | null;
  jevFallback: boolean;
}

export type ExitReason = 'first_red' | 'first_green' | 'kill_switch' | 'stop' | 'take_profit' | 'liquidated' | 'manual';

/** E3: stop and exit placement is retried for up to 10 minutes. */
export const PROTECT_RETRY_MS = 10 * 60 * 1000;

export interface ExecutorDeps {
  store: EngineStore;
  trading: BinanceTrading;
  notifier: Notifier;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

type Details = Record<string, string | number | boolean | null>;

const PLAN_NOTICE: Record<EntryPlanEvent, NotifyEvent> = {
  sizing_reduced: 'sizing_reduced',
  leverage_lowered: 'leverage_lowered',
  order_skipped_min_notional: 'order_skipped_min_notional',
};

/**
 * Carries out engine decisions on Binance and records them in the DB. What
 * to do comes from @cane/core; this class sequences the orders safely. Every
 * order row is written before its send, so a crash leaves a trace the
 * reconciler can finish (E1, AC6).
 */
export class Executor {
  private readonly log = new Logger('Executor');

  constructor(private readonly d: ExecutorDeps) {}

  // --- Entry (B3, B4, B6, B8, B9) ---

  async enter(s: StrategyRow, intent: EntryIntent): Promise<PositionRow | null> {
    const info = await this.d.trading.symbolInfo(s.market, s.pair);
    if (info.status !== 'TRADING') {
      await this.attention(s, `Symbol not trading: ${info.status}`, 'order_rejected', { pair: s.pair, status: info.status }); // E8
      return null;
    }

    let present = 0;
    let jevCallId: number | null = null;
    const jevFallback = intent.jev !== null && !intent.jev.result.ok;
    if (intent.jev) {
      const j = intent.jev;
      present = presentFactorCount(j.result, Number(s.confidenceThreshold));
      jevCallId = await this.d.store.insertJevCall({
        strategyId: s.id,
        signalId: intent.signalId,
        side: intent.side,
        timeframe: '1d',
        model: j.model,
        request: j.request ?? {},
        response: j.response,
        error: j.error,
        latencyMs: j.latencyMs,
        fallback: !j.result.ok,
      });
      if (!j.result.ok) await this.d.notifier.notify('jev_fallback', s.id, { pair: s.pair, reason: j.result.reason }); // B8.4
    }

    const { equity, free } = await this.balances(s.market);
    let brackets: LeverageBracket[] | undefined;
    if (s.market === 'futures') brackets = await this.d.trading.leverageBrackets(s.pair);
    const plan = planEntry({
      market: s.market,
      side: intent.side,
      mode: s.sizingMode,
      basePct: new Decimal(s.basePct),
      presentFactors: present,
      riskPct: s.riskPct === null ? undefined : new Decimal(s.riskPct),
      leverageCeiling: s.leverage ?? 1,
      equity,
      freeBalance: free,
      entryPrice: intent.refPrice,
      stop: intent.stop,
      takeProfit: intent.takeProfit,
      filters: info.filters,
      brackets,
    });
    for (const e of plan.events) {
      await this.d.notifier.notify(PLAN_NOTICE[e], s.id, { pair: s.pair, side: intent.side, sizePct: plan.sizePct.toString() });
    }
    if (plan.type === 'skip') {
      if (plan.reason !== 'min_notional') await this.d.notifier.notify('order_rejected', s.id, { pair: s.pair, reason: `entry skipped: ${plan.reason}` }); // B9.2
      return null;
    }

    const planned: PlannedEntry = {
      key: intent.key,
      side: intent.side,
      kind: intent.kind,
      signalTimeframe: intent.signalTimeframe,
      signalOpenTime: intent.signalOpenTime,
      stop: plan.stop.toFixed(),
      takeProfit: plan.takeProfit?.toFixed() ?? null,
      trend1w: intent.trend1w,
      sizePct: plan.sizePct.toFixed(),
      leverage: s.market === 'futures' ? plan.leverage : null,
      leverageCeiling: s.market === 'futures' ? s.leverage : null,
      presentFactors: present,
      jevCallId,
      jevFallback,
    };
    await this.d.store.annotateSignal(intent.signalId, { entry: planned });
    if (s.market === 'futures') await this.d.trading.ensureFuturesSetup(s.pair, s.marginMode ?? 'isolated', plan.leverage); // B9.1

    const entryId = clientOrderId(s.id, intent.key, 'entry');
    const side = intent.side === 'long' ? 'BUY' : 'SELL';
    await this.d.store.insertOrder({
      strategyId: s.id,
      signalId: intent.signalId,
      clientOrderId: entryId,
      market: s.market,
      pair: s.pair,
      side,
      type: 'MARKET',
      purpose: 'entry',
      status: PENDING,
      qty: plan.quantity.toFixed(),
    });
    let filled: OrderState;
    try {
      filled = await this.d.trading.placeMarket({ market: s.market, symbol: s.pair, side, quantity: plan.quantity, clientId: entryId });
    } catch (err) {
      // Only a Binance rejection is final. Anything else (unclear outcome, a crash
      // after the send) leaves the row PENDING for the reconciler to resolve (E1, AC6).
      if (!(err instanceof BinanceError)) throw err;
      await this.d.store.updateOrder(entryId, { status: 'REJECTED' });
      await this.d.notifier.notify('order_rejected', s.id, { pair: s.pair, action: 'entry', reason: errText(err) });
      return null;
    }
    return this.recordEntry(s, planned, filled);
  }

  /**
   * After the entry order is known to be filled (directly, or by the
   * reconciler after a crash): record the position and protect it (B3.4, B5.1).
   */
  async recordEntry(s: StrategyRow, planned: PlannedEntry, filled: OrderState): Promise<PositionRow | null> {
    await this.orderPlaced(filled);
    const qty = await this.heldQuantity(s, filled);
    if (qty.lte(0) || !filled.avgPrice) {
      await this.d.notifier.notify('order_rejected', s.id, { pair: s.pair, reason: `entry not filled (${filled.status})` });
      return null;
    }
    const position = await this.d.store.insertPosition({
      strategyId: s.id,
      market: s.market,
      pair: s.pair,
      side: planned.side,
      entryKind: planned.kind,
      signalTimeframe: planned.signalTimeframe,
      signalCandleOpenTime: planned.signalOpenTime,
      qty: qty.toFixed(),
      entryPrice: filled.avgPrice.toFixed(),
      stopPrice: planned.stop,
      takeProfitPrice: planned.takeProfit,
      leverage: planned.leverage,
      leverageCeiling: planned.leverageCeiling,
      sizePct: planned.sizePct,
      trend1w: planned.trend1w,
      jevCallId: planned.jevCallId,
      jevFallback: planned.jevFallback,
      openedAt: new Date(this.d.now()),
    });
    await this.d.store.updateOrder(filled.ref.clientId, { positionId: position.id });
    await this.d.notifier.notify('entry_filled', s.id, {
      pair: s.pair,
      side: planned.side,
      kind: planned.kind,
      qty: qty.toFixed(),
      price: filled.avgPrice.toFixed(),
      stop: planned.stop,
      takeProfit: planned.takeProfit,
      sizePct: planned.sizePct,
      factors: planned.presentFactors,
      leverage: planned.leverage,
    });
    if (planned.kind === 'flip') await this.d.notifier.notify(planned.side === 'short' ? 'flip_to_short' : 'flip_to_long', s.id, { pair: s.pair });

    // E6: the fill already crossed the stop, so the stop would fill at once: close instead.
    const stop = new Decimal(planned.stop);
    if (planned.side === 'long' ? filled.avgPrice.lte(stop) : filled.avgPrice.gte(stop)) {
      await this.exit(s, position, 'stop', planned.key, 'bail');
      return null;
    }
    await this.protect(s, position, planned.key);
    return position;
  }

  /** Quantity actually held: USDⓈ-M = filled; spot = filled − base fee, rounded down to the step. */
  private async heldQuantity(s: StrategyRow, filled: OrderState): Promise<Decimal> {
    if (s.market === 'futures' || filled.executedQty.isZero()) return filled.executedQty;
    const received = await this.d.trading.spotReceivedQuantity(filled, baseAsset(s.pair));
    const { filters } = await this.d.trading.symbolInfo('spot', s.pair);
    return roundDownToStep(received, filters.stepSize);
  }

  // --- Protective orders (B5) ---

  /**
   * Places the stop, plus the take-profit if the position has one: USDⓈ-M
   * algo stop + algo take-profit; spot STOP_LOSS, or an OCO with a
   * take-profit. `key` is the evaluated 4H candle, or the repair time for the
   * reconciler. Retried for up to 10 minutes (E3), then needs attention.
   */
  async protect(s: StrategyRow, p: PositionRow, key: number, withTakeProfit = true): Promise<boolean> {
    const qty = new Decimal(p.qty);
    const exitSide = p.side === 'long' ? 'SELL' : 'BUY';
    const away = p.side === 'long' ? 'down' : 'up';
    const { filters } = await this.d.trading.symbolInfo(s.market, s.pair);
    const stop = roundToTick(new Decimal(p.stopPrice), filters.tickSize, away);
    const tp = withTakeProfit && p.takeProfitPrice !== null ? roundToTick(new Decimal(p.takeProfitPrice), filters.tickSize, away) : null;
    const id = (a: OrderAction) => clientOrderId(s.id, key, a);

    return this.retry(s, 'place the stop', async () => {
      if (s.market === 'spot' && tp) {
        await this.orderRow(s, p, id('oco'), 'OCO', 'stop', qty, stop);
        await this.orderPlaced(
          await this.d.trading.placeSpotOco({ symbol: s.pair, quantity: qty, stopPrice: stop, takeProfitPrice: tp, listClientId: id('oco'), stopClientId: id('stop'), takeProfitClientId: id('tp') }),
        );
        return;
      }
      await this.orderRow(s, p, id('stop'), s.market === 'spot' ? 'STOP_LOSS' : 'STOP_MARKET', 'stop', qty, stop);
      await this.orderPlaced(await this.d.trading.placeStop({ market: s.market, symbol: s.pair, side: exitSide, quantity: qty, stopPrice: stop, clientId: id('stop') }));
      if (s.market === 'futures' && tp) {
        await this.orderRow(s, p, id('tp'), 'TAKE_PROFIT_MARKET', 'take_profit', qty, tp);
        await this.orderPlaced(await this.d.trading.placeFuturesTakeProfit({ symbol: s.pair, side: exitSide, quantity: qty, stopPrice: tp, clientId: id('tp') }));
      }
    });
  }

  /**
   * B5.3–5.4 trail move. USDⓈ-M: place the new stop first, then cancel the
   * old one (the take-profit stays). Spot: the old stop locks the balance, so
   * cancel it first, then place the new one (an OCO keeps its take-profit).
   * If the old spot stop is no longer open it may have filled: the reconciler
   * books that.
   */
  async moveStop(s: StrategyRow, p: PositionRow, newStop: Decimal, key: number): Promise<void> {
    const oldStops = (await this.d.store.protectiveOrders(p.id)).filter((o) => o.purpose === 'stop');
    const moved = { ...p, stopPrice: newStop.toFixed() };
    if (s.market === 'futures') {
      if (!(await this.protect(s, moved, key, false))) return;
      await this.d.store.updatePosition(p.id, { stopPrice: moved.stopPrice });
      for (const o of oldStops) await this.cancelRow(o);
      return;
    }
    for (const o of oldStops) {
      if ((await this.cancelRow(o)) === 'not_open') return;
    }
    await this.d.store.updatePosition(p.id, { stopPrice: moved.stopPrice });
    await this.protect(s, moved, key);
  }

  // --- Exit (B7) ---

  /**
   * Closes the position at market (B7.1/7.2 exit signal, E6 bail, kill
   * switch), cancels what is left (B7.3) and books the trade. If the exchange
   * shows it already closed (E7), nothing is sent and the reconciler books
   * how it closed. Returns the result when this call closed the position.
   */
  async exit(s: StrategyRow, p: PositionRow, reason: ExitReason, key: number, action: 'exit' | 'bail' | 'kill' = 'exit', signalId: number | null = null): Promise<TradePnl | null> {
    const exitId = clientOrderId(s.id, key, action);
    const protective = await this.d.store.protectiveOrders(p.id);
    await this.orderRow(s, p, exitId, 'MARKET', 'exit', new Decimal(p.qty), null, signalId);

    let result: ExitResult | null = null;
    const ok = await this.retry(s, 'close the position', async () => {
      result =
        s.market === 'futures'
          ? await this.d.trading.closeFuturesPosition(s.pair, exitId)
          : await this.d.trading.closeSpotPosition({ symbol: s.pair, baseAsset: baseAsset(s.pair), quantity: new Decimal(p.qty), protective: protective.map(refOf), clientId: exitId });
    });
    const done = result as ExitResult | null;
    if (!ok || !done) return null;
    if (done.kind === 'already_closed') {
      await this.d.store.updateOrder(exitId, { status: 'NOT_SENT' });
      return null;
    }
    await this.orderPlaced(done.order);
    for (const o of protective) await this.cancelRow(o); // B7.3 (spot ones are already cancelled)
    return this.recordClose(s, p, reason);
  }

  /** Books a closed position: PnL from its fills, trade row, position closed, notification. */
  async recordClose(s: StrategyRow, p: PositionRow, reason: ExitReason): Promise<TradePnl> {
    const pnl = await this.pnl(s, p);
    const closedAt = new Date(this.d.now());
    await this.d.store.insertTrade({
      positionId: p.id,
      strategyId: s.id,
      jevCallId: p.jevCallId,
      market: s.market,
      pair: s.pair,
      side: p.side,
      entryKind: p.entryKind,
      signalTimeframe: p.signalTimeframe,
      trend1w: p.trend1w,
      qty: pnl.qty.toFixed(),
      entryPrice: pnl.entryPrice.toFixed(),
      exitPrice: pnl.exitPrice.toFixed(),
      exitReason: reason,
      sizingMode: s.sizingMode,
      sizePct: p.sizePct,
      leverageConfigured: p.leverageCeiling,
      leverageUsed: p.leverage,
      jevFallback: p.jevFallback,
      grossPnl: pnl.grossPnl.toFixed(),
      fees: pnl.fees.toFixed(),
      funding: pnl.funding.toFixed(),
      netPnl: pnl.netPnl.toFixed(),
      openedAt: p.openedAt,
      closedAt,
    });
    await this.d.store.updatePosition(p.id, { status: 'closed', closedAt });
    const event: NotifyEvent = reason === 'stop' ? 'stop_triggered' : reason === 'take_profit' ? 'tp_triggered' : 'exit_filled';
    await this.d.notifier.notify(event, s.id, {
      pair: s.pair,
      side: p.side,
      reason,
      qty: pnl.qty.toFixed(),
      entry: pnl.entryPrice.toFixed(),
      exit: pnl.exitPrice.toFixed(),
      grossPnl: pnl.grossPnl.toFixed(),
      fees: pnl.fees.toFixed(),
      funding: pnl.funding.toFixed(),
      netPnl: pnl.netPnl.toFixed(),
    });
    return pnl;
  }

  private async pnl(s: StrategyRow, p: PositionRow): Promise<TradePnl> {
    const entry = await this.d.store.entryOrder(p.id);
    if (!entry?.exchangeOrderId) throw new Error(`position ${p.id} has no recorded entry order`);
    const closedAt = this.d.now();
    const fills = (await this.d.trading.fillsSince(s.market, s.pair, entry.exchangeOrderId)).filter((f) => f.time <= closedAt);
    if (s.market === 'spot') return spotPnl(baseAsset(s.pair), fills);
    return futuresPnl(p.side, fills, await this.d.trading.futuresFunding(s.pair, p.openedAt.getTime(), closedAt));
  }

  // --- Helpers ---

  private async balances(market: BinanceMarket): Promise<{ equity: Decimal; free: Decimal }> {
    if (market === 'futures') {
      const a = await this.d.trading.futuresAccount();
      return { equity: a.equity, free: a.available };
    }
    const [equity, balances] = await Promise.all([this.d.trading.spotEquityUsdt(), this.d.trading.spotBalances()]);
    return { equity, free: balances.get('USDT')?.free ?? new Decimal(0) };
  }

  /** Writes the order row before its send; a retry of the same order reuses the row. */
  private async orderRow(
    s: StrategyRow,
    p: PositionRow,
    clientId: string,
    type: string,
    purpose: 'stop' | 'take_profit' | 'exit',
    qty: Decimal,
    stopPrice: Decimal | null,
    signalId: number | null = null,
  ): Promise<void> {
    if (await this.d.store.orderByClientId(clientId)) return;
    await this.d.store.insertOrder({
      strategyId: s.id,
      signalId,
      positionId: p.id,
      clientOrderId: clientId,
      market: s.market,
      pair: s.pair,
      side: p.side === 'long' ? 'SELL' : 'BUY',
      type,
      purpose,
      status: PENDING,
      qty: qty.toFixed(),
      stopPrice: stopPrice?.toFixed() ?? null,
      reduceOnly: s.market === 'futures',
    });
  }

  private async orderPlaced(st: OrderState): Promise<void> {
    await this.d.store.updateOrder(st.ref.clientId, {
      status: st.status,
      exchangeOrderId: st.exchangeId,
      filledQty: st.executedQty.toFixed(),
      avgFillPrice: st.avgPrice?.toFixed() ?? null,
    });
  }

  /** Cancels a protective order and records its final status. */
  async cancelRow(o: OrderRow): Promise<'canceled' | 'not_open'> {
    const r = await this.d.trading.cancel(refOf(o));
    // Not open any more: ask how it ended (e.g. FILLED). A successful cancel is final.
    const status = r === 'canceled' ? 'CANCELED' : ((await this.d.trading.query(refOf(o)))?.status ?? 'NOT_FOUND');
    await this.d.store.updateOrder(o.clientOrderId, { status });
    return r;
  }

  /** E3: retries `fn` with back-off for up to 10 minutes; then `order_rejected` + needs_attention. */
  private async retry(s: StrategyRow, what: string, fn: () => Promise<void>): Promise<boolean> {
    const deadline = this.d.now() + PROTECT_RETRY_MS;
    for (let attempt = 1; ; attempt++) {
      try {
        await fn();
        return true;
      } catch (err) {
        if (err instanceof TradingDisabledError) throw err;
        this.log.warn(`${s.id} ${what} failed (attempt ${attempt}): ${errText(err)}`);
        if (this.d.now() >= deadline) {
          await this.attention(s, `Could not ${what}: ${errText(err)}`, 'order_rejected', { pair: s.pair, action: what });
          return false;
        }
        await this.d.sleep(Math.min(60_000, 5_000 * attempt));
      }
    }
  }

  async attention(s: StrategyRow, reason: string, event: NotifyEvent, details: Details): Promise<void> {
    await this.d.store.setStrategyStatus(s.id, 'needs_attention', reason);
    await this.d.store.audit('strategy_needs_attention', s.id, { reason, event });
    await this.d.notifier.notify(event, s.id, { ...details, reason });
  }
}

/** Rebuilds the Binance address of an order row. */
export function refOf(o: OrderRow): OrderRef {
  const algo = o.market === 'futures' && (o.type === 'STOP_MARKET' || o.type === 'TAKE_PROFIT_MARKET');
  return { market: o.market, kind: o.type === 'OCO' ? 'oco' : algo ? 'algo' : 'order', symbol: o.pair, clientId: o.clientOrderId };
}

/** USDT-quoted pair → base asset (`BTCUSDT` → `BTC`). Strategies use USDT pairs only (B10.6). */
export function baseAsset(pair: string): string {
  return pair.slice(0, -'USDT'.length);
}

export function errText(err: unknown): string {
  if (err instanceof BinanceError) return `${err.code ?? err.status} ${err.binanceMsg}`;
  return err instanceof Error ? err.message : String(err);
}
