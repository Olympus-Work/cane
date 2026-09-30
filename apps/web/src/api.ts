/** Thin fetch wrapper for the Cane API (same origin; the session cookie is HttpOnly, so JS never sees it). */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The server's `message` (a string, or the first of an array). Safe to show: the server never puts secrets in it. */
    readonly serverMessage: string,
    /** The server's machine-readable `code`, when it sends one (e.g. Binance key rejections). */
    readonly code: string | null,
    readonly extra: Record<string, unknown>,
  ) {
    super(`HTTP ${status}`);
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  constructor() {
    super('network error');
    this.name = 'NetworkError';
  }
}

export interface RequestOptions {
  body?: unknown;
  /** A fresh 6-digit TOTP code, sent as `x-totp-code` (B14.5). */
  totp?: string;
}

/** Only tests replace this. */
let fetchImpl: typeof fetch = (input, init) => fetch(input, init);
export function setFetchForTests(f: typeof fetch): void {
  fetchImpl = f;
}

export async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT', url: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.totp) headers['x-totp-code'] = opts.totp;
  let res: Response;
  try {
    res = await fetchImpl(url, { method, headers, credentials: 'same-origin', body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  } catch {
    throw new NetworkError();
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON: keep null */
  }
  if (res.ok) return json as T;
  const obj = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
  const msg = Array.isArray(obj.message) ? String(obj.message[0] ?? '') : typeof obj.message === 'string' ? obj.message : '';
  throw new ApiError(res.status, msg, typeof obj.code === 'string' ? obj.code : null, obj);
}

// --- Endpoint types (mirror apps/server: auth.controller, settings.controller, notify.controller) ---

export interface SessionInfo {
  id: string;
  device: string | null;
  ip: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export type SecretKey =
  | 'binance_api_key'
  | 'binance_api_secret'
  | 'jev_api_key'
  | 'line_channel_token'
  | 'line_user_id'
  | 'telegram_bot_token'
  | 'telegram_chat_id';

export interface SettingsView {
  /** Last 4 characters of each saved secret, or null when not set. Never the value. */
  secrets: Record<SecretKey, string | null>;
  jevTimeoutMs: number | null;
}

export const DEFAULT_JEV_TIMEOUT_MS = 3000;

export const login = (email: string, password: string, code: string) => api<{ expiresAt: string }>('POST', '/v1/auth/login', { body: { email, password, code } });
export const logout = () => api<void>('POST', '/v1/auth/logout');
export const listSessions = () => api<{ sessions: SessionInfo[] }>('GET', '/v1/auth/sessions');
export const changePassword = (currentPassword: string, newPassword: string) => api<void>('POST', '/v1/auth/password', { body: { currentPassword, newPassword } });
export const beginTotpSetup = (totp: string) => api<{ secret: string; uri: string }>('POST', '/v1/auth/totp/setup', { body: {}, totp });
export const confirmTotpSetup = (code: string) => api<{ recoveryCodes: string[] }>('POST', '/v1/auth/totp/confirm', { body: { code } });
export const regenerateRecoveryCodes = (totp: string) => api<{ recoveryCodes: string[] }>('POST', '/v1/auth/recovery-codes', { body: {}, totp });
export const readSettings = () => api<SettingsView>('GET', '/v1/settings');
export const saveBinanceKey = (apiKey: string, apiSecret: string, totp: string) => api<{ apiKey: string }>('PUT', '/v1/settings/binance-key', { body: { apiKey, apiSecret }, totp });
export const saveNotifications = (fields: { lineChannelToken?: string; lineUserId?: string; telegramBotToken?: string; telegramChatId?: string }, totp: string) =>
  api<{ changed: string[] }>('PUT', '/v1/settings/notifications', { body: fields, totp });
export const saveJev = (fields: { apiKey?: string; timeoutMs?: number }, totp: string) => api<{ apiKey: string | null; timeoutMs: number | null }>('PUT', '/v1/settings/jev', { body: fields, totp });
export const sendTestMessage = (channel: 'line' | 'telegram') => api<{ ok: boolean; error?: string }>('POST', '/v1/settings/notifications/test', { body: { channel } });
