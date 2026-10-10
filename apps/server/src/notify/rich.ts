/**
 * Rich layouts for the plain notification text (ClickUp z8p29877e5): a LINE Flex
 * bubble and Telegram HTML. Pure: the input is the stored outbox text from
 * `renderMessage` (`[Title] S-01` then `field: value` lines) plus the event,
 * which only picks the colour. The plain text stays the source of truth.
 */
import type { NotifyEvent } from '../engine/ports.js';

type Tone = 'good' | 'bad' | 'warn' | 'info';

const TONE: Partial<Record<NotifyEvent, Tone>> = {
  entry_filled: 'good',
  tp_triggered: 'good',
  stop_triggered: 'bad',
  order_rejected: 'bad',
  kill_switch: 'bad',
  login_failed_lockout: 'bad',
  jev_fallback: 'warn',
  order_skipped_min_notional: 'warn',
  sizing_reduced: 'warn',
  leverage_lowered: 'warn',
  reconcile_mismatch: 'warn',
};

/** Header colours; `info` is the Cane indigo. */
const COLOR: Record<Tone, string> = { good: '#16A34A', bad: '#DC2626', warn: '#D97706', info: '#4F46E5' };
const DOT: Record<Tone, string> = { good: '🟢', bad: '🔴', warn: '🟠', info: '🟣' };

/** Readable names for the whitelist fields in templates.ts; an unknown field keeps its own name. */
const LABELS: Record<string, string> = {
  pair: 'Pair',
  side: 'Side',
  kind: 'Kind',
  action: 'Action',
  reason: 'Reason',
  qty: 'Qty',
  price: 'Price',
  entry: 'Entry',
  exit: 'Exit',
  stop: 'Stop',
  takeProfit: 'Take-profit',
  sizePct: 'Size %',
  leverage: 'Leverage',
  factors: 'Factors',
  grossPnl: 'Gross PnL',
  fees: 'Fees',
  funding: 'Funding',
  netPnl: 'Net PnL',
  env: 'Env',
  minutes: 'Minutes',
  day: 'Day',
  what: 'Detail',
};

/** LINE caps `altText` at 400 characters. */
const LINE_ALT_MAX = 400;
/** Telegram caps a message at 4096 characters. */
const TELEGRAM_MAX = 4096;

export interface ParsedMessage {
  title: string;
  strategyId: string | null;
  rows: { label: string; value: string }[];
}

/** Split the stored text back into title, strategy ID and rows. A line without `: ` continues the previous value. */
export function parseMessage(text: string): ParsedMessage {
  const [head = '', ...rest] = text.split('\n');
  const m = /^\[([^\]]+)\](?: (.+))?$/.exec(head);
  const parsed: ParsedMessage = { title: m ? m[1]! : head, strategyId: m?.[2] ?? null, rows: [] };
  for (const line of rest) {
    const at = line.indexOf(': ');
    const last = parsed.rows.at(-1);
    if (at === -1) {
      if (last) last.value += `\n${line}`;
      else if (line !== '') parsed.rows.push({ label: '', value: line });
      continue;
    }
    const field = line.slice(0, at);
    parsed.rows.push({ label: LABELS[field] ?? field, value: line.slice(at + 2) });
  }
  return parsed;
}

const toneOf = (event: NotifyEvent | null): Tone => (event ? (TONE[event] ?? 'info') : 'info');

/** One LINE push message: a Flex bubble with a coloured header and a label / value body. */
export function lineFlexMessage(text: string, event: NotifyEvent | null): Record<string, unknown> {
  const { title, strategyId, rows } = parseMessage(text);
  const header: Record<string, unknown>[] = [{ type: 'text', text: title, color: '#FFFFFF', weight: 'bold', size: 'md', wrap: true }];
  if (strategyId !== null) header.push({ type: 'text', text: strategyId, color: '#FFFFFFCC', size: 'sm' });
  const bubble: Record<string, unknown> = {
    type: 'bubble',
    size: 'kilo',
    header: { type: 'box', layout: 'vertical', backgroundColor: COLOR[toneOf(event)], paddingAll: '14px', contents: header },
  };
  if (rows.length > 0) {
    bubble.body = {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: rows.map(({ label, value }) => ({
        type: 'box',
        layout: 'horizontal',
        spacing: 'md',
        contents: [
          // Flex text must not be empty.
          { type: 'text', text: label || '-', size: 'sm', color: '#8C8C8C', flex: 2 },
          { type: 'text', text: value || '-', size: 'sm', color: '#111111', flex: 3, align: 'end', wrap: true },
        ],
      })),
    };
  }
  return { type: 'flex', altText: text.slice(0, LINE_ALT_MAX), contents: bubble };
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Telegram `sendMessage` fields: HTML with a coloured dot, or the plain text when the HTML would be too long. */
export function telegramHtmlFields(text: string, event: NotifyEvent | null): { text: string; parse_mode?: 'HTML' } {
  const { title, strategyId, rows } = parseMessage(text);
  const head = `${DOT[toneOf(event)]} <b>${escapeHtml(title)}</b>${strategyId !== null ? ` · ${escapeHtml(strategyId)}` : ''}`;
  const body = rows.map(({ label, value }) => (label ? `<b>${escapeHtml(label)}:</b> ${escapeHtml(value)}` : escapeHtml(value)));
  const html = body.length > 0 ? `${head}\n\n${body.join('\n')}` : head;
  return html.length > TELEGRAM_MAX ? { text } : { text: html, parse_mode: 'HTML' };
}
