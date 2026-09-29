/**
 * What an order does. `fix` is a stop re-placed by the reconciler (B12.2) and
 * `kill` an order sent by the kill switch (B11); both are keyed to the time
 * of that event instead of a candle.
 */
export type OrderAction = 'entry' | 'stop' | 'tp' | 'oco' | 'exit' | 'fix' | 'kill';

export const ORDER_ACTIONS: readonly OrderAction[] = ['entry', 'stop', 'tp', 'oco', 'exit', 'fix', 'kill'];

/** Binance accepts client order IDs matching this (spot and USDⓈ-M). */
export const CLIENT_ORDER_ID_RE = /^[.A-Z:/a-z0-9_-]{1,36}$/;

const STRATEGY_ID_RE = /^S-[0-9]{2,}$/;

/**
 * Deterministic client order ID `<strategy_id>-<candle_open_time>-<action>`
 * (spec Interfaces). The same strategy, candle and action always give the same
 * ID, so a resend after a timeout is recognised (E1).
 */
export function clientOrderId(strategyId: string, candleOpenTime: number, action: OrderAction): string {
  if (!STRATEGY_ID_RE.test(strategyId)) throw new Error(`invalid strategy id: ${strategyId}`);
  if (!Number.isSafeInteger(candleOpenTime) || candleOpenTime < 0) {
    throw new Error(`invalid candle open time: ${candleOpenTime}`);
  }
  if (!ORDER_ACTIONS.includes(action)) throw new Error(`invalid order action: ${String(action)}`);
  const id = `${strategyId}-${candleOpenTime}-${action}`;
  if (!CLIENT_ORDER_ID_RE.test(id)) throw new Error(`client order id too long or invalid: ${id}`);
  return id;
}
