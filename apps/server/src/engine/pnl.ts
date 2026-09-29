import { Decimal } from 'decimal.js';
import type { Side } from '@cane/core';
import type { Fill } from '../binance/trading.js';

/** Realised result of one closed position (B16.5–16.6: gross, fees, funding, net). */
export interface TradePnl {
  qty: Decimal;
  entryPrice: Decimal;
  exitPrice: Decimal;
  grossPnl: Decimal;
  fees: Decimal;
  funding: Decimal;
  netPnl: Decimal;
}

const ZERO = new Decimal(0);

function avg(fills: Fill[]): Decimal {
  const qty = fills.reduce((s, f) => s.plus(f.qty), ZERO);
  return qty.isZero() ? ZERO : fills.reduce((s, f) => s.plus(f.quoteQty), ZERO).div(qty);
}

function qtyOf(fills: Fill[]): Decimal {
  return fills.reduce((s, f) => s.plus(f.qty), ZERO);
}

/**
 * USDⓈ-M: gross = Binance's realised PnL of the closing fills; fees = USDT
 * commissions of all fills; net = gross − fees + funding. `fills` are the
 * position's own fills (entry to close).
 */
export function futuresPnl(side: Side, fills: Fill[], funding: Decimal): TradePnl {
  const opening = fills.filter((f) => f.buy === (side === 'long'));
  const closing = fills.filter((f) => f.buy !== (side === 'long'));
  const grossPnl = fills.reduce((s, f) => s.plus(f.realizedPnl ?? 0), ZERO);
  const fees = fills.filter((f) => f.commissionAsset === 'USDT').reduce((s, f) => s.plus(f.commission), ZERO);
  return {
    qty: qtyOf(closing),
    entryPrice: avg(opening),
    exitPrice: avg(closing),
    grossPnl,
    fees,
    funding,
    netPnl: grossPnl.minus(fees).plus(funding),
  };
}

/**
 * Spot long: gross = (average sell − average buy) × quantity sold; fees =
 * every commission valued in USDT (a base-asset fee at its fill price).
 * Fees paid in a third asset (e.g. BNB) are not valued and count as 0.
 */
export function spotPnl(baseAsset: string, fills: Fill[]): TradePnl {
  const buys = fills.filter((f) => f.buy);
  const sells = fills.filter((f) => !f.buy);
  const qty = qtyOf(sells);
  const entryPrice = avg(buys);
  const exitPrice = avg(sells);
  const fees = fills.reduce((s, f) => {
    if (f.commissionAsset === 'USDT') return s.plus(f.commission);
    if (f.commissionAsset === baseAsset) return s.plus(f.commission.times(f.price));
    return s;
  }, ZERO);
  const grossPnl = exitPrice.minus(entryPrice).times(qty);
  return { qty, entryPrice, exitPrice, grossPnl, fees, funding: ZERO, netPnl: grossPnl.minus(fees) };
}
