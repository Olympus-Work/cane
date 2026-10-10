/**
 * Notification channels (LINE, Telegram). Pure: no Nest, no env, no clock —
 * the fetch function and the timeout budget are injected so tests can fake both.
 */

import type { NotifyEvent } from '../engine/ports.js';
import { lineFlexMessage, telegramHtmlFields } from './rich.js';

export type SendResult = { ok: true } | { ok: false; error: string };

export interface Channel {
  readonly name: 'line' | 'telegram';
  /** `event` only picks the colour of the rich layout; null (the Settings test message) uses the default. */
  send(text: string, event?: NotifyEvent | null): Promise<SendResult>;
}

export type NotifyFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

export const CHANNEL_TIMEOUT_MS = 5000;

/** Outbound messages are cut to this many characters before sending. */
const MAX_TEXT_CHARS = 4000;
/** Error strings are cut to this many characters so they fit in a notification. */
const MAX_ERROR_CHARS = 200;

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

/** Replace every occurrence of each secret in the error with `***`, then cut to 200 characters. */
function redact(error: string, secrets: string[]): string {
  let out = error;
  for (const secret of secrets) {
    if (secret === '') continue;
    out = out.split(secret).join('***');
  }
  return out.slice(0, MAX_ERROR_CHARS);
}

/** Only the error class: a message can contain the request URL. */
function networkError(e: unknown): string {
  return `network error (${e instanceof Error ? e.name : 'unknown'})`;
}

function httpError(status: number, message: string | undefined): string {
  return message !== undefined ? `HTTP ${status}: ${message}` : `HTTP ${status}`;
}

/** Read the provider's error message from a JSON body; undefined when the body is not JSON or lacks the field. */
function providerMessage(body: string, pick: (p: Record<string, unknown>) => string | undefined): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  return pick(parsed as Record<string, unknown>);
}

interface PostSpec {
  url: string;
  headers: Record<string, string>;
  body: (text: string) => string;
  secrets: string[];
  /** undefined = success; otherwise the error text before redaction. */
  failure: (status: number, body: string) => string | undefined;
}

/** One POST with a timer abort; every failure comes back as `{ ok: false, error }`, never a throw. */
async function post(spec: PostSpec, fetchFn: NotifyFetch, timeoutMs: number, text: string): Promise<SendResult> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    let res: { status: number; text(): Promise<string> };
    try {
      res = await fetchFn(spec.url, {
        method: 'POST',
        headers: spec.headers,
        body: spec.body(text.slice(0, MAX_TEXT_CHARS)),
        signal: abort.signal,
      });
    } catch (e) {
      // If the timer fired, the request was aborted by us: report a timeout.
      return { ok: false, error: redact(abort.signal.aborted ? 'timeout' : networkError(e), spec.secrets) };
    }
    const body = await res.text();
    const error = spec.failure(res.status, body);
    if (error === undefined) return { ok: true };
    return { ok: false, error: redact(error, spec.secrets) };
  } catch (e) {
    return { ok: false, error: redact(networkError(e), spec.secrets) };
  } finally {
    clearTimeout(timer);
  }
}

function lineFailure(status: number, body: string): string | undefined {
  if (status === 200) return undefined;
  return httpError(status, providerMessage(body, (p) => (typeof p.message === 'string' ? p.message : undefined)));
}

/**
 * A provider that rejects the rich layout (HTTP 400) gets the same text once more as plain text,
 * so a layout the provider does not accept never loses an alert.
 */
async function richThenPlain(rich: () => Promise<SendResult>, plain: () => Promise<SendResult>): Promise<SendResult> {
  const result = await rich();
  return !result.ok && result.error.startsWith('HTTP 400') ? plain() : result;
}

export function lineChannel(cfg: { channelToken: string; userId: string }, fetchFn: NotifyFetch, timeoutMs?: number): Channel {
  const push = (text: string, message: (t: string) => Record<string, unknown>) =>
    post(
      {
        url: LINE_PUSH_URL,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.channelToken}` },
        body: (t) => JSON.stringify({ to: cfg.userId, messages: [message(t)] }),
        secrets: [cfg.channelToken, cfg.userId],
        failure: lineFailure,
      },
      fetchFn,
      timeoutMs ?? CHANNEL_TIMEOUT_MS,
      text,
    );
  return {
    name: 'line',
    send: (text, event = null) =>
      richThenPlain(
        () => push(text, (t) => lineFlexMessage(t, event)),
        () => push(text, (t) => ({ type: 'text', text: t })),
      ),
  };
}

function telegramFailure(status: number, body: string): string | undefined {
  const description = providerMessage(body, (p) => (typeof p.description === 'string' ? p.description : undefined));
  if (status !== 200) return httpError(status, description);
  // HTTP 200 is a success only when the body is JSON with `ok === true`.
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return 'HTTP 200: unexpected response';
  }
  if (typeof parsed === 'object' && parsed !== null && (parsed as Record<string, unknown>).ok === true) return undefined;
  return description !== undefined ? `HTTP 200: ${description}` : 'HTTP 200: unexpected response';
}

export function telegramChannel(cfg: { botToken: string; chatId: string }, fetchFn: NotifyFetch, timeoutMs?: number): Channel {
  const sendMessage = (text: string, fields: (t: string) => { text: string; parse_mode?: 'HTML' }) =>
    post(
      {
        url: `https://api.telegram.org/bot${cfg.botToken}/sendMessage`,
        headers: { 'content-type': 'application/json' },
        body: (t) => JSON.stringify({ chat_id: cfg.chatId, ...fields(t) }),
        secrets: [cfg.botToken, cfg.chatId],
        failure: telegramFailure,
      },
      fetchFn,
      timeoutMs ?? CHANNEL_TIMEOUT_MS,
      text,
    );
  return {
    name: 'telegram',
    send: (text, event = null) =>
      richThenPlain(
        () => sendMessage(text, (t) => telegramHtmlFields(t, event)),
        () => sendMessage(text, (t) => ({ text: t })),
      ),
  };
}
