import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Request } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Shared helpers for the S10 web smoke tests. Every /v1 call is mocked here so
 * the tests never need the real Nest server (the Vite dev server is enough).
 */

const BASE = 'http://localhost:5199';

export interface MockApiOptions {
  signedIn: boolean;
}

const NOW = '2026-09-26T10:00:00.000Z';
const EXPIRES = '2026-09-26T11:00:00.000Z';

function sessionsBody() {
  return {
    sessions: [
      {
        id: 's1',
        device: 'Playwright',
        ip: '203.0.113.7',
        createdAt: NOW,
        expiresAt: EXPIRES,
        current: true,
      },
    ],
  };
}

const SETTINGS_BODY = {
  secrets: {
    binance_api_key: '4F2A',
    binance_api_secret: '9Z9Z',
    jev_api_key: null,
    line_channel_token: 'a1b2',
    line_user_id: 'c3d4',
    telegram_bot_token: null,
    telegram_chat_id: null,
  },
  jevTimeoutMs: null,
};

// --- S10b fixtures. Shapes mirror the types in src/api.ts; money, prices and
// quantities are decimal strings. ---

export const DASHBOARD_BODY = {
  status: 'running',
  lastSyncAt: NOW,
  stale: false,
  cards: {
    spotEquity: '4120.55',
    futuresEquity: '10000',
    realisedToday: '312.45',
    realisedTotal: '1284.9',
    tradeCount: 3,
    openPositions: { spot: 1, futures: 1 },
  },
  alerts: [
    { kind: 'needs_attention', strategyId: 'S-03', pair: 'SOLUSDT', reason: 'Stop order missing — re-placed', link: 'strategies' },
    { kind: 'jev_fallback', count: 1, link: 'trades' },
  ],
  positions: [
    {
      strategyId: 'S-01',
      sizingMode: 'B',
      pair: 'BTCUSDT',
      market: 'futures',
      side: 'long',
      qty: '0.05',
      entryPrice: '61240',
      markPrice: '62100',
      change24hPct: '1.2',
      unrealizedPnl: '43',
      unrealizedPnlPct: '1.40',
      stopPrice: '58000',
      takeProfitPrice: null,
      liquidationPrice: '50000',
      leverage: 5,
      openedAt: '2026-09-25T02:30:00.000Z',
    },
    {
      strategyId: 'S-02',
      sizingMode: null,
      pair: 'ETHUSDT',
      market: 'spot',
      side: 'long',
      qty: '0.6',
      entryPrice: '3450',
      markPrice: '3435',
      change24hPct: '-0.8',
      unrealizedPnl: '-3',
      unrealizedPnlPct: '-0.50',
      stopPrice: '3200',
      takeProfitPrice: null,
      liquidationPrice: null,
      leverage: null,
      openedAt: '2026-09-24T08:15:00.000Z',
    },
  ],
};

export const HEATMAP_BODY = {
  days: 365,
  items: [
    { day: '2026-09-20', trades: 1, wins: 1, losses: 0, pnl: '45', level: 1 },
    { day: '2026-09-21', trades: 0, wins: 0, losses: 0, pnl: '0', level: 0 },
    { day: '2026-09-22', trades: 2, wins: 1, losses: 1, pnl: '-12', level: 2 },
    { day: '2026-09-23', trades: 1, wins: 0, losses: 1, pnl: '-30', level: 2 },
    { day: '2026-09-24', trades: 3, wins: 3, losses: 0, pnl: '128', level: 3 },
  ],
};

export const TRADES_BODY = {
  items: [
    {
      id: 3,
      strategyId: 'S-01',
      pair: 'BTCUSDT',
      market: 'futures',
      side: 'long',
      entryPrice: '61240',
      exitPrice: '62100',
      qty: '0.05',
      netPnl: '10.3',
      exitReason: 'take_profit',
      openedAt: '2026-09-23T04:00:00.000Z',
      closedAt: '2026-09-24T09:30:00.000Z',
    },
    {
      id: 2,
      strategyId: 'S-02',
      pair: 'ETHUSDT',
      market: 'spot',
      side: 'long',
      entryPrice: '3450',
      exitPrice: '3390',
      qty: '0.6',
      netPnl: '-36',
      exitReason: 'stop',
      openedAt: '2026-09-22T01:20:00.000Z',
      closedAt: '2026-09-23T06:45:00.000Z',
    },
    {
      id: 1,
      strategyId: 'S-03',
      pair: 'SOLUSDT',
      market: 'futures',
      side: 'short',
      entryPrice: '152.4',
      exitPrice: '152.4',
      qty: '20',
      netPnl: '0',
      exitReason: 'first_green',
      openedAt: '2026-09-21T11:05:00.000Z',
      closedAt: '2026-09-22T03:40:00.000Z',
    },
  ],
  nextBefore: null,
};

export const TRADE_DETAIL_BODY = {
  id: 3,
  strategyId: 'S-01',
  pair: 'BTCUSDT',
  market: 'futures',
  side: 'long',
  entryPrice: '61240',
  exitPrice: '62100',
  qty: '0.05',
  netPnl: '10.3',
  exitReason: 'take_profit',
  openedAt: '2026-09-23T04:00:00.000Z',
  closedAt: '2026-09-24T09:30:00.000Z',
  entryKind: 'signal',
  signalTimeframe: '4h',
  trend1w: 'up',
  factors: [
    { name: 'channel_breakout', confidence: '0.82', present: true, counted: true },
    { name: 'capitulation', confidence: '0.74', present: true, counted: true },
    { name: 'higher_low', confidence: '0.41', present: false, counted: false },
  ],
  threshold: '0.70',
  jevFallback: false,
  sizingMode: 'B',
  sizePct: '50',
  leverage: { configured: 5, used: 3, lowered: true },
  pnl: { gross: '12', fees: '1.5', funding: '-0.2', net: '10.3' },
};

export const AUDIT_BODY = {
  items: [
    { id: 3, at: '2026-09-26T09:58:00.000Z', actor: 'owner', action: 'settings_changed', target: null, before: null, after: { jevTimeoutMs: 3 }, ip: '203.0.113.7' },
    { id: 2, at: '2026-09-25T02:29:00.000Z', actor: 'owner', action: 'strategy_enable', target: 'S-01', before: { status: 'disabled' }, after: { status: 'enabled' }, ip: '203.0.113.7' },
    { id: 1, at: '2026-09-24T07:00:00.000Z', actor: 'owner', action: 'login_success', target: null, before: null, after: null, ip: '203.0.113.7' },
  ],
  nextBefore: null,
};

const DAILY_PNL30 = Array.from({ length: 30 }, (_, i) => ({ day: `2026-08-${String(i + 1).padStart(2, '0')}`, pnl: i % 4 === 0 ? '-4' : '6' }));

export const STRATEGIES_BODY = {
  items: [
    {
      id: 'S-01',
      pair: 'BTCUSDT',
      market: 'futures',
      status: 'enabled',
      attentionReason: null,
      sizingMode: 'B',
      marginMode: 'isolated',
      leverageCeiling: 5,
      leverageInUse: 3,
      basePct: '10',
      confidenceThreshold: '0.70',
      riskPct: null,
      price: '62100',
      change24hPct: '1.2',
      position: {
        side: 'long',
        qty: '0.05',
        entryPrice: '61240',
        stopPrice: '58000',
        takeProfitPrice: null,
        leverage: 3,
        openedAt: '2026-09-25T02:30:00.000Z',
        unrealizedPnl: '43',
      },
      locked: true,
      pnl30d: { total: '84', daily: DAILY_PNL30 },
    },
    {
      id: 'S-02',
      pair: 'ETHUSDT',
      market: 'spot',
      status: 'enabled',
      attentionReason: null,
      sizingMode: 'B',
      marginMode: null,
      leverageCeiling: null,
      leverageInUse: null,
      basePct: '10',
      confidenceThreshold: '0.70',
      riskPct: null,
      price: '3435',
      change24hPct: '-0.8',
      position: null,
      locked: false,
      pnl30d: { total: '21', daily: DAILY_PNL30 },
    },
    {
      id: 'S-03',
      pair: 'SOLUSDT',
      market: 'futures',
      status: 'needs_attention',
      attentionReason: 'Stop order missing — re-placed',
      sizingMode: 'A',
      marginMode: 'cross',
      leverageCeiling: 10,
      leverageInUse: 10,
      basePct: '15',
      confidenceThreshold: '0.80',
      riskPct: null,
      price: '152.4',
      change24hPct: '0.4',
      position: null,
      locked: false,
      pnl30d: { total: '-12', daily: DAILY_PNL30 },
    },
    {
      id: 'S-04',
      pair: 'ADAUSDT',
      market: 'futures',
      status: 'disabled',
      attentionReason: null,
      sizingMode: 'C',
      marginMode: 'isolated',
      leverageCeiling: 2,
      leverageInUse: null,
      basePct: '10',
      confidenceThreshold: '0.60',
      riskPct: '2',
      price: '0.42',
      change24hPct: '-2.1',
      position: null,
      locked: false,
      pnl30d: { total: '0', daily: DAILY_PNL30 },
    },
  ],
  lastSyncAt: NOW,
  stale: false,
  exchangeError: null,
};

export const SIZING_PREVIEW_BODY = {
  market: 'futures',
  sizingMode: 'B',
  equity: '10000',
  stale: false,
  exchangeError: null,
  rows: [
    { factors: 0, sizePct: '10', notional: '1000', margin: '200' },
    { factors: 2, sizePct: '50', notional: '5000', margin: '1000' },
    { factors: 3, sizePct: '70', notional: '7000', margin: '1400' },
  ],
};

export const KILL_BODY = {
  activatedAt: '2026-09-27T07:02:11.000Z',
  results: [
    { pair: 'BTCUSDT', market: 'futures', what: 'Long 0.05 · 2 orders', status: 'closed' },
    { pair: 'ETHUSDT', market: 'spot', what: '2 orders', status: 'cancelled' },
  ],
  untouched: [{ pair: 'XRPUSDT', market: 'spot' }],
};

/**
 * Install route handlers for every /v1 request. `signedIn` controls the
 * session probe (200 vs 401); the login POST always succeeds. Anything
 * unmatched is a 404 `{}`.
 */
export async function mockApi(page: Page, opts: MockApiOptions): Promise<void> {
  await page.route('**/v1/**', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();

    if (method === 'GET' && url.pathname === '/v1/auth/sessions') {
      if (opts.signedIn) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sessionsBody()) });
      }
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Not signed in' }) });
    }

    if (method === 'GET' && url.pathname === '/v1/settings') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SETTINGS_BODY) });
    }

    if (method === 'POST' && url.pathname === '/v1/auth/login') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ expiresAt: EXPIRES }) });
    }

    // The S10b screens only exist for a signed-in user.
    if (opts.signedIn) {
      if (method === 'GET' && url.pathname === '/v1/dashboard') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DASHBOARD_BODY) });
      }
      if (method === 'GET' && url.pathname.startsWith('/v1/dashboard/heatmap')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HEATMAP_BODY) });
      }
      if (method === 'GET' && url.pathname === '/v1/trades/3') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TRADE_DETAIL_BODY) });
      }
      if (method === 'GET' && url.pathname === '/v1/trades') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TRADES_BODY) });
      }
      if (method === 'GET' && url.pathname === '/v1/audit-log') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AUDIT_BODY) });
      }
      if (method === 'GET' && url.pathname === '/v1/strategies/sizing-preview') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SIZING_PREVIEW_BODY) });
      }
      if (method === 'GET' && url.pathname === '/v1/strategies') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STRATEGIES_BODY) });
      }
      if (method === 'POST' && url.pathname === '/v1/kill-switch') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(KILL_BODY) });
      }
    }

    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({}) });
  });
}

/**
 * Record the origin of EVERY request the page makes and return a function
 * that yields the list of origins seen so far.
 */
export function trackRequests(page: Page): () => string[] {
  const origins = new Set<string>();
  page.on('request', (req: Request) => {
    origins.add(new URL(req.url()).origin);
  });
  return () => [...origins];
}

/** Set the persisted language before the app reads it on first load. */
export async function setLang(page: Page, lang: 'en' | 'th'): Promise<void> {
  await page.addInitScript((l) => {
    localStorage.setItem('cane.lang', l);
  }, lang);
}

/** Save a full-page PNG to `apps/web/e2e/screenshots/<name>.png`. */
export async function shot(page: Page, name: string): Promise<void> {
  const dir = join(HERE, 'screenshots');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}

export { BASE };
