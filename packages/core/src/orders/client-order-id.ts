/**
 * What an order does. `bail` is the immediate close of an entry whose fill
 * already crossed its stop (E6); it can share an evaluation with a flip's
 * `exit`. `kill` is an order sent by the kill switch (B11).
 */
export type OrderAction = 'entry' | 'stop' | 'tp' | 'oco' | 'exit' | 'bail' | 'kill';

export const ORDER_ACTIONS: readonly OrderAction[] = ['entry', 'stop', 'tp', 'oco', 'exit', 'bail', 'kill'];

/** Binance accepts client order IDs matching this (spot and USDⓈ-M). */
export const CLIENT_ORDER_ID_RE = /^[.A-Z:/a-z0-9_-]{1,36}$/;

const STRATEGY_ID_RE = /^S-[0-9]{2,}$/;

/**
 * Deterministic client order ID `<strategy_id>-<candle_open_time>-<action>`
 * (spec Interfaces). The candle is the closed 4H candle whose evaluation
 * sent the order — each strategy is evaluated once per 4H candle (B1.2), so
 * within one evaluation each action is used at most once. Orders sent outside
 * an evaluation (reconciler repair, kill switch) use the time of that event.
 * The same inputs always give the same ID, so a resend after a timeout or a
 * restart is recognised (E1).
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
