import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFetchForTests, type Dashboard, type KillResult } from '../src/api';
import { App } from '../src/App';
import { KillModal } from '../src/components/KillModal';
import { ToastProvider } from '../src/components/Toast';
import { I18nProvider } from '../src/i18n/index';
import { KillSwitch } from '../src/pages/KillSwitch';
import { ThemeProvider } from '../src/theme';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const killResult: KillResult = {
  activatedAt: '2026-09-27T07:02:11.000Z',
  results: [
    { pair: 'BTCUSDT', market: 'futures', what: 'Long 0.050 · 2 orders', status: 'closed' },
    { pair: 'SOLUSDT', market: 'spot', what: 'Orders cancelled', status: 'cancelled' },
    { pair: 'ETHUSDT', market: 'futures', what: 'Short 1.0 · 1 order', status: 'failed' },
  ],
  untouched: [{ pair: 'XRPUSDT', market: 'spot' }],
};

const dashboard = (status: Dashboard['status']): Dashboard => ({
  status,
  lastSyncAt: '2026-09-27T07:02:11.000Z',
  stale: false,
  cards: { spotEquity: '1', futuresEquity: '2', realisedToday: '0', realisedTotal: '0', tradeCount: 0, openPositions: { spot: 0, futures: 0 } },
  alerts: [],
  positions: [],
});

function mockFetch(dash: Dashboard, kill: KillResult | number) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/v1/auth/sessions')) return json(200, { sessions: [] });
    if (url.endsWith('/v1/dashboard')) return json(200, dash);
    if (url.includes('/v1/dashboard/heatmap')) return json(200, { days: 365, items: [] });
    if (url.endsWith('/v1/settings')) return json(200, { secrets: {}, jevTimeoutMs: null });
    if (url.endsWith('/v1/kill-switch')) {
      return typeof kill === 'number' ? json(kill, {}) : json(200, kill);
    }
    return json(404, {});
  });
}

function wrap(ui: ReactElement) {
  return (
    <ThemeProvider>
      <I18nProvider initial="en">
        <ToastProvider>{ui}</ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

describe('KillSwitch page', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the intro with the Stop all trading button when no result yet', () => {
    const onRequestKill = vi.fn();
    const onNavigate = vi.fn();
    render(wrap(<KillSwitch result={null} onRequestKill={onRequestKill} onNavigate={onNavigate} />));
    expect(screen.getByRole('heading', { name: 'Kill switch' })).toBeTruthy();
    expect(screen.getByText('Stops all trading immediately. Use it when something looks wrong.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop all trading' }));
    expect(onRequestKill).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('shows the per-pair result after the kill switch ran', () => {
    const onNavigate = vi.fn();
    render(wrap(<KillSwitch result={killResult} onRequestKill={() => {}} onNavigate={onNavigate} />));
    expect(screen.getByRole('heading', { name: /Trading stopped/ })).toBeTruthy();
    expect(screen.getByText('2026-09-27 14:02')).toBeTruthy(); // Asia/Bangkok
    expect(screen.getByText('2 / 3')).toBeTruthy();
    expect(screen.getByText('Closed')).toBeTruthy();
    // 'Orders cancelled' appears twice: the SOLUSDT row's `what` and its status.
    expect(screen.getAllByText('Orders cancelled').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Failed · retrying')).toBeTruthy();
    expect(screen.getByText('Long 0.050 · 2 orders')).toBeTruthy();
    expect(screen.getByText('Short 1.0 · 1 order')).toBeTruthy();
    expect(screen.getByText('Positions not opened by Cane were not touched (XRPUSDT Spot).')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'How to resume' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to Strategies' }));
    expect(onNavigate).toHaveBeenCalledWith('strategies');
  });

  it('lists the pairs and markets of the result rows', () => {
    render(wrap(<KillSwitch result={killResult} onRequestKill={() => {}} onNavigate={() => {}} />));
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.kill-row'));
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain('BTCUSDT · Futures');
    expect(rows[1]!.textContent).toContain('SOLUSDT · Spot');
    expect(rows[2]!.textContent).toContain('ETHUSDT · Futures');
  });

  it('shows the empty note when nothing was open', () => {
    render(wrap(<KillSwitch result={{ ...killResult, results: [] }} onRequestKill={() => {}} onNavigate={() => {}} />));
    expect(screen.getByText('No Cane positions or orders were open.')).toBeTruthy();
  });

  it('drops the pair list from the note when untouched is empty', () => {
    render(wrap(<KillSwitch result={{ ...killResult, untouched: [] }} onRequestKill={() => {}} onNavigate={() => {}} />));
    expect(screen.getByText('Positions not opened by Cane were not touched.')).toBeTruthy();
  });

  it('says Binance could not be read when untouched is null', () => {
    render(wrap(<KillSwitch result={{ ...killResult, untouched: null }} onRequestKill={() => {}} onNavigate={() => {}} />));
    expect(screen.getByText('Positions not opened by Cane were not touched. Binance could not be read to list them.')).toBeTruthy();
  });
});

describe('KillModal', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('asks for confirmation, no TOTP, and reports the result', async () => {
    const fetchMock = mockFetch(dashboard('running'), killResult);
    setFetchForTests(fetchMock);
    const onClose = vi.fn();
    const onDone = vi.fn();
    render(wrap(<KillModal onClose={onClose} onDone={onDone} />));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Stop all trading?');
    expect(screen.getByRole('heading', { name: 'Stop all trading?' })).toBeTruthy();
    expect(screen.getByText('This acts immediately and cannot be undone in one step.')).toBeTruthy();
    expect(screen.getByText('Disable all strategies')).toBeTruthy();
    expect(screen.getByText('Cancel all orders placed by Cane')).toBeTruthy();
    expect(screen.getByText('Close all Cane positions at market')).toBeTruthy();
    expect(screen.getByText('Positions not opened by Cane are not touched')).toBeTruthy();
    expect(dialog.querySelector('input')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Stop all trading' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onDone).toHaveBeenCalledWith(killResult);
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/v1/kill-switch'));
    expect(call).toBeTruthy();
    expect(call![1]!.method).toBe('POST');
  });

  it('shows the unavailable note on a 404 and does not call onDone', async () => {
    setFetchForTests(mockFetch(dashboard('running'), 404));
    const onClose = vi.fn();
    const onDone = vi.fn();
    render(wrap(<KillModal onClose={onClose} onDone={onDone} />));
    fireEvent.click(screen.getByRole('button', { name: 'Stop all trading' }));
    expect((await screen.findByRole('alert')).textContent).toContain('The kill switch is not available on this server yet.');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows the server error on a 500 and does not call onDone', async () => {
    setFetchForTests(mockFetch(dashboard('running'), 500));
    const onClose = vi.fn();
    const onDone = vi.fn();
    render(wrap(<KillModal onClose={onClose} onDone={onDone} />));
    fireEvent.click(screen.getByRole('button', { name: 'Stop all trading' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong on the server. Try again.');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('closes without acting on Cancel', () => {
    setFetchForTests(mockFetch(dashboard('running'), killResult));
    const onClose = vi.fn();
    const onDone = vi.fn();
    render(wrap(<KillModal onClose={onClose} onDone={onDone} />));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('App shell: status pill, kill banner and mobile layout', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    document.documentElement.classList.remove('light');
  });

  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  function renderApp(dash: Dashboard, kill: KillResult | number) {
    setFetchForTests(mockFetch(dash, kill));
    return render(
      <ThemeProvider>
        <I18nProvider initial="en">
          <ToastProvider>
            <App />
          </ToastProvider>
        </I18nProvider>
      </ThemeProvider>,
    );
  }

  function pill() {
    return screen.findByRole('status', { name: 'System status' });
  }

  it('reads Running while the dashboard is running', async () => {
    renderApp(dashboard('running'), killResult);
    expect((await pill()).textContent).toContain('Running');
  });

  it('reads Exchange unreachable when the exchange is down', async () => {
    renderApp(dashboard('exchange_unreachable'), killResult);
    // The pill exists before the first dashboard answer; wait for the text to change.
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'System status' }).textContent).toContain('Exchange unreachable');
    });
  });

  it('reads Stopped by kill switch and shows the banner', async () => {
    renderApp(dashboard('stopped_by_kill_switch'), killResult);
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'System status' }).textContent).toContain('Stopped by kill switch');
    });
    expect(screen.getByRole('alert').textContent).toContain('Trading stopped');
  });

  it('opens the modal from the header and lands on the result page after confirming', async () => {
    renderApp(dashboard('running'), killResult);
    await pill();
    fireEvent.click(screen.getByRole('button', { name: 'Kill switch' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop all trading' }));
    expect(await screen.findByRole('heading', { name: /Trading stopped/ })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Trading stopped');
  });

  it('shows the desktop nav with Dashboard, Strategies and Settings', async () => {
    renderApp(dashboard('running'), killResult);
    await pill();
    expect(screen.getByRole('button', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Strategies' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
  });

  it('on mobile hides the nav and shows the sticky kill bar instead', async () => {
    window.matchMedia = (query: string) =>
      ({
        matches: query === '(max-width: 767px)',
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
    renderApp(dashboard('running'), killResult);
    await pill();
    expect(screen.queryByRole('button', { name: 'Strategies' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
    const killBar = document.querySelector('.kill-bar-button');
    expect(killBar).toBeTruthy();
    expect(killBar!.textContent).toContain('Kill switch');
  });
});
