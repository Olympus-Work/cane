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

export async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, opts: RequestOptions = {}): Promise<T> {
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

// --- Dashboard, strategies, trades, audit (mirror apps/server: dashboard, strategies, trades, audit controllers). Money, prices and quantities are decimal strings. ---

export type Market = 'spot' | 'futures';
export type Side = 'long' | 'short';
export type SizingMode = 'A' | 'B' | 'C';
export type MarginMode = 'isolated' | 'cross';
export type StrategyStatus = 'enabled' | 'disabled' | 'needs_attention' | 'closed';
export type ExchangeError = 'no_key' | 'key_rejected' | 'unreachable' | null;

export type DashboardAlert =
  | { kind: 'needs_attention'; strategyId: string; pair: string; reason: string | null; link: 'strategies' }
  | { kind: 'jev_fallback'; count: number; link: 'trades' }
  | { kind: 'exchange_unreachable'; link: 'settings' }
  | { kind: 'key_error'; link: 'settings' };

export interface DashboardPosition {
  strategyId: string;
  sizingMode: SizingMode | null;
  pair: string;
  market: Market;
  side: Side;
  qty: string;
  entryPrice: string;
  markPrice: string | null;
  change24hPct: string | null;
  unrealizedPnl: string | null;
  unrealizedPnlPct: string | null;
  stopPrice: string;
  takeProfitPrice: string | null;
  liquidationPrice: string | null;
  leverage: number | null;
  openedAt: string;
}

export interface Dashboard {
  status: 'running' | 'exchange_unreachable' | 'stopped_by_kill_switch';
  lastSyncAt: string | null;
  stale: boolean;
  cards: {
    spotEquity: string | null;
    futuresEquity: string | null;
    realisedToday: string;
    realisedTotal: string;
    tradeCount: number;
    openPositions: { spot: number; futures: number };
  };
  alerts: DashboardAlert[];
  positions: DashboardPosition[];
}

export interface HeatmapDay {
  day: string; // YYYY-MM-DD, Asia/Bangkok
  trades: number;
  wins: number;
  losses: number;
  pnl: string;
  level: 0 | 1 | 2 | 3 | 4;
}

export type ExitReason = 'first_red' | 'first_green' | 'stop' | 'take_profit' | 'kill_switch' | 'flip' | string;

export interface TradeSummary {
  id: number;
  strategyId: string;
  pair: string;
  market: Market;
  side: Side;
  entryPrice: string;
  exitPrice: string;
  qty: string;
  netPnl: string;
  exitReason: ExitReason;
  openedAt: string;
  closedAt: string;
}

export interface TradeDetail extends TradeSummary {
  entryKind: string;
  signalTimeframe: string;
  trend1w: string | null;
  factors: { name: string; confidence: string; present: boolean; counted: boolean }[] | null;
  threshold: string | null;
  jevFallback: boolean;
  sizingMode: SizingMode;
  sizePct: string;
  leverage: { configured: number | null; used: number | null; lowered: boolean };
  pnl: { gross: string; fees: string; funding: string; net: string };
}

export interface AuditItem {
  id: number;
  at: string;
  actor: string;
  action: string;
  target: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
}

export interface Paged<T> {
  items: T[];
  nextBefore: number | null;
}

export interface StrategyItem {
  id: string;
  pair: string;
  market: Market;
  status: StrategyStatus;
  attentionReason: string | null;
  sizingMode: SizingMode;
  marginMode: MarginMode | null;
  leverageCeiling: number | null;
  leverageInUse: number | null;
  basePct: string;
  confidenceThreshold: string;
  riskPct: string | null;
  price: string | null;
  change24hPct: string | null;
  position: {
    side: Side;
    qty: string;
    entryPrice: string;
    stopPrice: string;
    takeProfitPrice: string | null;
    leverage: number | null;
    openedAt: string;
    unrealizedPnl: string | null;
  } | null;
  /** B10.7: pair, market, leverage and margin mode cannot be edited while true. */
  locked: boolean;
  pnl30d: { total: string; daily: { day: string; pnl: string }[] };
}

export interface StrategyList {
  items: StrategyItem[];
  lastSyncAt: string | null;
  stale: boolean;
  exchangeError: ExchangeError;
}

export interface StrategyInput {
  pair: string;
  market: Market;
  leverage: number | null;
  sizingMode: SizingMode;
  marginMode: MarginMode | null;
  basePct: string;
  confidenceThreshold: string;
  riskPct: string | null;
}

export interface SizingPreview {
  market: Market;
  sizingMode: SizingMode;
  equity: string | null;
  stale: boolean;
  exchangeError: ExchangeError;
  rows: { factors: 0 | 2 | 3; sizePct: string; notional: string | null; margin: string | null }[];
}

const qs = (params: Record<string, string | number | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const readDashboard = () => api<Dashboard>('GET', '/v1/dashboard');
export const readHeatmap = (days: number) => api<{ days: number; items: HeatmapDay[] }>('GET', `/v1/dashboard/heatmap${qs({ days })}`);
export const listTrades = (limit = 50, before?: number) => api<Paged<TradeSummary>>('GET', `/v1/trades${qs({ limit, before })}`);
export const readTrade = (id: number) => api<TradeDetail>('GET', `/v1/trades/${id}`);
export const listAudit = (limit = 50, before?: number) => api<Paged<AuditItem>>('GET', `/v1/audit-log${qs({ limit, before })}`);
export const listStrategies = () => api<StrategyList>('GET', '/v1/strategies');
export const sizingPreview = (q: { market: Market; sizingMode: SizingMode; basePct: string; leverage?: number }) => api<SizingPreview>('GET', `/v1/strategies/sizing-preview${qs(q)}`);
export const createStrategy = (input: StrategyInput) => api<{ id: string; status: StrategyStatus }>('POST', '/v1/strategies', { body: input });
export const editStrategy = (id: string, patch: Partial<StrategyInput>) => api<StrategyInput & { id: string }>('PATCH', `/v1/strategies/${id}`, { body: patch });
export const enableStrategy = (id: string, totp: string) => api<{ id: string; status: StrategyStatus }>('POST', `/v1/strategies/${id}/enable`, { body: {}, totp });
export const disableStrategy = (id: string) => api<{ id: string; status: StrategyStatus }>('POST', `/v1/strategies/${id}/disable`, { body: {} });
export const closeStrategy = (id: string) => api<{ id: string; status: StrategyStatus }>('POST', `/v1/strategies/${id}/close`, { body: {} });

// --- Kill switch (POST /v1/kill-switch, S11; contract recorded in plan.md) ---

export interface KillResultRow {
  pair: string;
  market: Market;
  /** What was done, e.g. "Long 0.050 · 2 orders". Plain text from the server. */
  what: string;
  status: 'closed' | 'cancelled' | 'failed';
}

export interface KillResult {
  activatedAt: string;
  results: KillResultRow[];
  /** Positions the system did not open; reported, never touched (B11.3). */
  untouched: { pair: string; market: Market }[];
}

export const activateKillSwitch = () => api<KillResult>('POST', '/v1/kill-switch', { body: {} });
