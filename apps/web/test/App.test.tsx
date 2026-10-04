import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFetchForTests } from '../src/api';
import { App } from '../src/App';
import { ToastProvider } from '../src/components/Toast';
import { I18nProvider } from '../src/i18n/index';
import { ThemeProvider } from '../src/theme';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const settingsView = { secrets: { binance_api_key: '4F2A', binance_api_secret: '9Z9Z', jev_api_key: null, line_channel_token: null, line_user_id: null, telegram_bot_token: null, telegram_chat_id: null }, jevTimeoutMs: null };

function renderApp(lang: 'en' | 'th' = 'en') {
  return render(
    <ThemeProvider>
      <I18nProvider initial={lang}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

describe('App session gate', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('light');
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the Login page when the session probe says 401', async () => {
    setFetchForTests(vi.fn(async () => json(401, { message: 'Not signed in' })));
    renderApp();
    expect(await screen.findByText('Sign in to Cane')).toBeTruthy();
  });

  it('opens on the Dashboard when signed in, and Settings shows the saved key masked', async () => {
    setFetchForTests(
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/v1/auth/sessions')) return json(200, { sessions: [] });
        if (url.endsWith('/v1/settings')) return json(200, settingsView);
        return json(404, {});
      }),
    );
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(await screen.findByText(/4F2A/)).toBeTruthy();
    expect(screen.queryByText(/9Z9Z/)).toBeNull(); // only the key's own hint is shown
  });

  it('offers a retry when the server cannot be reached, and recovers', async () => {
    let up = false;
    setFetchForTests(
      vi.fn(async (input: RequestInfo | URL) => {
        if (!up) throw new TypeError('network down');
        return String(input).endsWith('/v1/settings') ? json(200, settingsView) : json(200, { sessions: [] });
      }),
    );
    renderApp();
    const retry = await screen.findByRole('button', { name: 'Try again' });
    up = true;
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy());
  });

  it('shows the retry screen, not the login wall, when the probe fails with a server error', async () => {
    setFetchForTests(vi.fn(async () => json(500, { message: 'boom' })));
    renderApp();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText('Sign in to Cane')).toBeNull();
  });

  it('switches to Thai', async () => {
    setFetchForTests(vi.fn(async () => json(401, {})));
    renderApp('th');
    expect(await screen.findByText('เข้าสู่ระบบ Cane')).toBeTruthy();
  });
});
