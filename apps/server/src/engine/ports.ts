import { Logger } from '@nestjs/common';
import type { ConfluenceFeatures, JevResult, Side } from '@cane/core';

/** B13.1 events the engine raises. */
export type NotifyEvent =
  | 'entry_filled'
  | 'exit_filled'
  | 'stop_triggered'
  | 'tp_triggered'
  | 'jev_fallback'
  | 'order_rejected'
  | 'order_skipped_min_notional'
  | 'sizing_reduced'
  | 'leverage_lowered'
  | 'reconcile_mismatch'
  | 'flip_to_short'
  | 'flip_to_long'
  | 'system_started'
  | 'login_failed_lockout'
  | 'login_success'
  | 'settings_changed'
  | 'kill_switch';

/**
 * Notification sink (B13). `details` holds only trade data (pair, side,
 * quantities, prices, PnL, reasons) — never keys, tokens or account IDs
 * (B13.3). S09 sends these to LINE and Telegram.
 */
export interface Notifier {
  notify(event: NotifyEvent, strategyId: string | null, details: Record<string, string | number | boolean | null>): Promise<void>;
}

/** Until S09: log the event only. */
export class LogNotifier implements Notifier {
  private readonly log = new Logger('Notify');

  async notify(event: NotifyEvent, strategyId: string | null, details: Record<string, string | number | boolean | null>): Promise<void> {
    this.log.log(`${event} ${strategyId ?? '-'} ${JSON.stringify(details)}`);
  }
}

/** One Jev call as stored with the trade (B8.5). */
export interface JevCall {
  result: JevResult;
  model: string;
  request: unknown;
  response: unknown;
  error: string | null;
  latencyMs: number | null;
}

/** B8: classifies the three factors for one side on the signal candle. */
export interface JevClassifier {
  classify(input: { side: Side; timeframe: '1d'; features: ConfluenceFeatures }): Promise<JevCall>;
}

/** Until S07: Jev is not wired, which B8.4 treats like an error (base size, `jev_fallback`). */
export class UnavailableJev implements JevClassifier {
  async classify(): Promise<JevCall> {
    return { result: { ok: false, reason: 'error' }, model: 'none', request: null, response: null, error: 'Jev client not configured (S07)', latencyMs: null };
  }
}
