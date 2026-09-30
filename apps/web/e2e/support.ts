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
