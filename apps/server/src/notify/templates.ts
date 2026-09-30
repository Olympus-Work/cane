import type { NotifyEvent } from '../engine/ports.js';

/** Detail values a notification may carry (B13.3: trade data only). */
export type NotifyDetails = Record<string, string | number | boolean | null>;

const TITLES: Record<NotifyEvent, string> = {
  entry_filled: 'Entry filled',
  exit_filled: 'Exit filled',
  stop_triggered: 'Stop triggered',
  tp_triggered: 'Take-profit triggered',
  jev_fallback: 'Jev unavailable, base size used',
  order_rejected: 'Order rejected',
  order_skipped_min_notional: 'Order skipped: below minimum size',
  sizing_reduced: 'Size reduced',
  leverage_lowered: 'Leverage lowered',
  reconcile_mismatch: 'Reconcile mismatch',
  flip_to_short: 'Flip to short',
  flip_to_long: 'Flip to long',
  system_started: 'System started',
  login_failed_lockout: 'Login locked after failed attempts',
  login_success: 'Login',
  settings_changed: 'Settings changed',
};

/** Fields allowed in a notification body, in render order. */
const FIELDS = [
  'pair',
  'side',
  'kind',
  'action',
  'reason',
  'qty',
  'price',
  'entry',
  'exit',
  'stop',
  'takeProfit',
  'sizePct',
  'leverage',
  'factors',
  'grossPnl',
  'fees',
  'funding',
  'netPnl',
  'env',
  'minutes',
  'what',
] as const;

/**
 * Strip token-like material from a string: any run of 32+ characters from
 * the base64/hex/ID alphabet becomes `[redacted]`, then the result is cut
 * to 200 characters (197 + '...'). Redaction happens before truncation so
 * a token can never be cut into a shorter unredacted piece.
 */
export function scrub(value: string): string {
  const redacted = value.replace(/[A-Za-z0-9_+/=:-]{32,}/g, '[redacted]');
  return redacted.length > 200 ? `${redacted.slice(0, 197)}...` : redacted;
}

/** Render a notification body: `[TITLE] [strategyId]` plus whitelisted fields. */
export function renderMessage(event: NotifyEvent, strategyId: string | null, details: NotifyDetails): string {
  const title = TITLES[event];
  const lines = [strategyId === null ? `[${title}]` : `[${title}] ${strategyId}`];
  for (const field of FIELDS) {
    const value = details[field];
    if (value === null || value === undefined) continue;
    const rendered = typeof value === 'string' ? scrub(value) : String(value);
    lines.push(`${field}: ${rendered}`);
  }
  return lines.join('\n');
}
