import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFetchForTests, type AuditItem, type Dashboard as DashboardData, type DashboardAlert, type DashboardPosition, type Paged, type TradeDetail, type TradeSummary } from '../src/api.js';
import { ToastProvider } from '../src/components/Toast.js';
import { I18nProvider } from '../src/i18n/index.js';
import type { Poll } from '../src/lib/usePoll.js';
import { Dashboard } from '../src/pages/Dashboard.js';
import { ThemeProvider } from '../src/theme.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const settingsView = { secrets: { binance_api_key: null, binance_api_secret: null, jev_api_key: null, line_channel_token: null, line_user_id: null, telegram_bot_token: null, telegram_chat_id: null }, jevTimeoutMs: null };

const position = (over: Partial<DashboardPosition> = {}): DashboardPosition => ({
  strategyId: 'strat-1',
  sizingMode: 'A',
  pair: 'BTCUSDT',
  market: 'spot',
  side: 'long',
  qty: '0.05',
  entryPrice: '61240.5',
  markPrice: '61500',
  change24hPct: '1.2',
  unrealizedPnl: '12.9',
  unrealizedPnlPct: '0.42',
  stopPrice: '59000',
  takeProfitPrice: null,
  liquidationPrice: null,
  leverage: null,
  openedAt: '2026-09-24T09:00:00Z',
  ...over,
});

function dashboard(over: Partial<DashboardData> = {}): DashboardData {
  return {
    status: 'running',
    lastSyncAt: '2026-09-26T06:02:11Z',
    stale: false,
    cards: {
      spotEquity: '4120.55',
      futuresEquity: '1200',
      realisedToday: '312.45',
      realisedTotal: '1500.1',
      tradeCount: 12,
      openPositions: { spot: 1, futures: 1 },
    },
    alerts: [],
    positions: [],
    ...over,
  };
}

const pollOf = (data: DashboardData | null, error: unknown = null): Poll<DashboardData> => ({ data, error, loading: false, reload: vi.fn() });

const trade = (id: number, over: Partial<TradeSummary> = {}): TradeSummary => ({
  id,
  strategyId: 'strat-1',
  pair: 'BTCUSDT',
  market: 'spot',
  side: 'long',
  entryPrice: '61240.5',
  exitPrice: '61800',
  qty: '0.05',
  netPnl: '27.95',
  exitReason: 'stop',
  openedAt: '2026-09-24T09:00:00Z',
  closedAt: '2026-09-25T09:00:00Z',
  ...over,
});

const tradeDetail: TradeDetail = {
  ...trade(1),
  entryKind: 'signal',
  signalTimeframe: '4H',
  trend1w: 'up',
  factors: null,
  threshold: null,
  jevFallback: false,
  sizingMode: 'A',
  sizePct: '10',
  leverage: { configured: null, used: null, lowered: false },
  pnl: { gross: '30', fees: '2.05', funding: '0', net: '27.95' },
};

const auditItem: AuditItem = {
  id: 1,
  at: '2026-09-26T05:00:00Z',
  actor: 'owner',
  action: 'strategy_enable',
  target: 'BTCUSDT',
  before: null,
  after: { status: 'enabled' },
  ip: '10.0.0.5',
};

/** Routes the page's own fetches; each test supplies only the routes it cares about. */
function mockFetch(opts: { trades?: (url: URL) => Paged<TradeSummary>; tradeDetail?: TradeDetail; audit?: Paged<AuditItem> }) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://x');
    if (url.pathname === '/v1/dashboard/heatmap') return json(200, { days: 365, items: [] });
    if (url.pathname === '/v1/settings') return json(200, settingsView);
    if (url.pathname === '/v1/trades' && opts.trades) return json(200, opts.trades(url));
    const one = url.pathname.match(/^\/v1\/trades\/(\d+)$/);
    if (one && opts.tradeDetail) return json(200, opts.tradeDetail);
    if (url.pathname === '/v1/audit-log' && opts.audit) return json(200, opts.audit);
    return json(404, {});
  });
}

function renderPage(poll: Poll<DashboardData>) {
  const nav = vi.fn();
  const utils = render(
    <ThemeProvider>
      <I18nProvider initial="en">
        <ToastProvider>
          <Dashboard poll={poll} onNavigate={nav} />
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
  return { ...utils, nav };
}

function getTab(container: HTMLElement, name: string): HTMLElement {
  const tab = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find((t) => t.textContent?.startsWith(name));
  if (!tab) throw new Error(`tab ${name} not found`);
  return tab;
}

const attention = (strategyId: string, pair: string, reason: string | null): DashboardAlert => ({ kind: 'needs_attention', strategyId, pair, reason, link: 'strategies' });

describe('Dashboard page', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('light');
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows five skeleton stat cards and the syncing status while loading', async () => {
    setFetchForTests(mockFetch({}));
    const { container } = renderPage({ data: null, error: null, loading: true, reload: vi.fn() });
    expect(container.querySelectorAll('.stat-card[aria-busy="true"]').length).toBe(5);
    expect(await screen.findByText('Syncing…')).toBeTruthy();
  });

  it('shows the stat cards, the open positions sub-line and the selected tab', async () => {
    const dash = dashboard({ positions: [position(), position({ strategyId: 'strat-2', pair: 'SOLUSDT', market: 'futures', side: 'short', leverage: 5 })] });
    setFetchForTests(mockFetch({}));
    const { container } = renderPage(pollOf(dash));
    expect(await screen.findByText('Spot equity')).toBeTruthy();
    expect(screen.getByText('4,120.55 USDT')).toBeTruthy();
    expect(screen.getByText('+312.45 USDT').className).toContain('pnl-up');
    expect(screen.getByText('Spot 1 · Futures 1')).toBeTruthy();
    const posTab = getTab(container, 'Open positions');
    expect(posTab.getAttribute('aria-selected')).toBe('true');
    expect(posTab.querySelector('.tab-count')?.textContent).toBe(String(dash.positions.length));
  });

  it('offers a new strategy when there are no open positions', async () => {
    setFetchForTests(mockFetch({}));
    const { nav } = renderPage(pollOf(dashboard()));
    expect(await screen.findByText('No open positions')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New strategy' }));
    expect(nav).toHaveBeenCalledWith('strategies');
  });

  it('shows a needs-attention banner with the pair, the reason and a Review button', async () => {
    const dash = dashboard({ alerts: [attention('strat-1', 'SOLUSDT', 'Position differs from exchange (reconciliation)')] });
    setFetchForTests(mockFetch({}));
    const { nav } = renderPage(pollOf(dash));
    expect(await screen.findByText('SOLUSDT needs attention')).toBeTruthy();
    expect(screen.getByText('Position differs from exchange (reconciliation)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(nav).toHaveBeenCalledWith('strategies');
  });

  it('collapses two needs-attention alerts into one banner', async () => {
    const dash = dashboard({ alerts: [attention('strat-1', 'SOLUSDT', 'Order rejected: insufficient margin'), attention('strat-2', 'ETHUSDT', 'Stop order missing — re-placed')] });
    setFetchForTests(mockFetch({}));
    const { container } = renderPage(pollOf(dash));
    expect(await screen.findByText('2 strategies need attention')).toBeTruthy();
    expect(container.querySelectorAll('.dash-alert-orange').length).toBe(1);
  });

  it('shows a key error alert with an Open settings button', async () => {
    const dash = dashboard({ alerts: [{ kind: 'key_error', link: 'settings' }] });
    setFetchForTests(mockFetch({}));
    const { nav } = renderPage(pollOf(dash));
    expect(await screen.findByText('Exchange key error')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(nav).toHaveBeenCalledWith('settings');
  });

  it('hides the Open settings button on mobile, where Settings is not reachable', async () => {
    const original = window.matchMedia;
    window.matchMedia = (query: string) =>
      ({ matches: query === '(max-width: 767px)', media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as MediaQueryList;
    try {
      const dash = dashboard({ alerts: [{ kind: 'key_error', link: 'settings' }] });
      setFetchForTests(mockFetch({}));
      renderPage(pollOf(dash));
      expect(await screen.findByText('Exchange key error')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Open settings' })).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });

  it('shows the Jev fallback count and its View button switches to the Trade history tab', async () => {
    const dash = dashboard({ alerts: [{ kind: 'jev_fallback', count: 2, link: 'trades' }] });
    setFetchForTests(mockFetch({ trades: () => ({ items: [], nextBefore: null }) }));
    const { container } = renderPage(pollOf(dash));
    expect(await screen.findByText('2 entries in the last 24 h opened at base size after Jev did not answer.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(getTab(container, 'Trade history').getAttribute('aria-selected')).toBe('true');
  });

  it('marks the stat grid stale and shows the last sync when polling fails', async () => {
    setFetchForTests(mockFetch({}));
    const { container } = renderPage(pollOf(dashboard(), new Error('boom')));
    await screen.findByText('Spot equity');
    expect(container.querySelector('.stat-grid')?.className).toContain('stale');
    expect(await screen.findByText(/Last sync/)).toBeTruthy();
  });

  it('opens a trade drawer from the history tab and closes it on Escape', async () => {
    setFetchForTests(mockFetch({ trades: () => ({ items: [trade(1)], nextBefore: null }), tradeDetail }));
    const { container } = renderPage(pollOf(dashboard()));
    fireEvent.click(getTab(container, 'Trade history'));
    const row = await screen.findByRole('button', { name: /BTCUSDT/ });
    fireEvent.click(row);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes the drawer on an Escape pressed the moment it appears', async () => {
    // Fires inside the commit that adds the dialog, before passive effects run (the CI flake on the test above).
    setFetchForTests(mockFetch({ trades: () => ({ items: [trade(1)], nextBefore: null }), tradeDetail }));
    const { container } = renderPage(pollOf(dashboard()));
    fireEvent.click(getTab(container, 'Trade history'));
    const row = await screen.findByRole('button', { name: /BTCUSDT/ });
    const pressed = new Promise<void>((resolve) => {
      const mo = new MutationObserver(() => {
        if (!document.querySelector('[role="dialog"]')) return;
        mo.disconnect();
        fireEvent.keyDown(document, { key: 'Escape' });
        resolve();
      });
      mo.observe(document.body, { childList: true, subtree: true });
    });
    fireEvent.click(row);
    await pressed;
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('appends older trades via Load more and hides the button when the cursor is exhausted', async () => {
    const fetchMock = mockFetch({
      trades: (url) =>
        url.searchParams.get('before') === '7'
          ? { items: [trade(6, { pair: 'ETHUSDT' })], nextBefore: null }
          : { items: [trade(8), trade(7)], nextBefore: 7 },
    });
    setFetchForTests(fetchMock);
    const { container } = renderPage(pollOf(dashboard()));
    fireEvent.click(getTab(container, 'Trade history'));
    const more = await screen.findByRole('button', { name: 'Load more' });
    fireEvent.click(more);
    expect(await screen.findByText('ETHUSDT')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    const requested = fetchMock.mock.calls.map(([input]) => new URL(String(input), 'http://x'));
    expect(requested.some((u) => u.pathname === '/v1/trades' && u.searchParams.get('before') === '7')).toBe(true);
  });

  it('loads the audit log on demand and shows the secrets note', async () => {
    setFetchForTests(mockFetch({ audit: { items: [auditItem], nextBefore: null } }));
    const { container } = renderPage(pollOf(dashboard()));
    fireEvent.click(getTab(container, 'Audit log'));
    expect(await screen.findByText('Strategy enable')).toBeTruthy();
    expect(screen.getByText('Secrets are never written to the audit log.')).toBeTruthy();
  });
});
