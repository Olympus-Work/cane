import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { SizingPreview, StrategyItem, StrategyList } from '../src/api.js';
import { setFetchForTests } from '../src/api.js';
import { Strategies } from '../src/pages/Strategies.js';
import { ToastProvider } from '../src/components/Toast.js';
import { I18nProvider } from '../src/i18n/index.js';
import { ThemeProvider } from '../src/theme.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

type Handler = (pathname: string, method: string | undefined, init: RequestInit | undefined) => Response | Promise<Response>;

function mockFetch(handler: Handler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://x');
    return handler(url.pathname, init?.method, init);
  });
  setFetchForTests(fn);
  return fn;
}

function item(overrides: Partial<StrategyItem> & Pick<StrategyItem, 'id' | 'pair' | 'status'>): StrategyItem {
  return {
    market: 'futures',
    attentionReason: null,
    sizingMode: 'B',
    marginMode: 'isolated',
    leverageCeiling: 5,
    leverageInUse: null,
    basePct: '10',
    confidenceThreshold: '0.7',
    riskPct: null,
    price: '100',
    change24hPct: null,
    position: null,
    locked: false,
    pnl30d: { total: '0', daily: [] },
    ...overrides,
  };
}

const list = (items: StrategyItem[], extra: Partial<StrategyList> = {}): StrategyList => ({
  items,
  lastSyncAt: '2026-09-26T14:02:11Z',
  stale: false,
  exchangeError: null,
  ...extra,
});

const position: NonNullable<StrategyItem['position']> = {
  side: 'long',
  qty: '0.05',
  entryPrice: '61240',
  stopPrice: '59000',
  takeProfitPrice: null,
  leverage: 5,
  openedAt: '2026-09-24T02:00:00Z',
  unrealizedPnl: '12.5',
};

const preview: SizingPreview = {
  market: 'futures',
  sizingMode: 'B',
  equity: '10000',
  stale: false,
  exchangeError: null,
  rows: [
    { factors: 0, sizePct: '10', notional: '10000', margin: '2000' },
    { factors: 2, sizePct: '14', notional: '14000', margin: '2800' },
    { factors: 3, sizePct: '18', notional: '18000', margin: '3600' },
  ],
};

function renderStrategies(onEnabled = vi.fn()) {
  const utils = render(
    <ThemeProvider>
      <I18nProvider initial="en">
        <ToastProvider>
          <Strategies onEnabled={onEnabled} />
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
  return { onEnabled, ...utils };
}

const saveButton = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

describe('Strategies page', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the loading state with a disabled New strategy button, then the rows', async () => {
    let resolveFirst!: (r: Response) => void;
    const items = [item({ id: 'S-01', pair: 'BTCUSDT', status: 'enabled', position })];
    let calls = 0;
    mockFetch((pathname, method) => {
      if (pathname === '/v1/strategies' && method === 'GET') {
        calls += 1;
        if (calls === 1) return new Promise<Response>((r) => (resolveFirst = r));
        return json(200, list(items));
      }
      return json(404, {});
    });
    renderStrategies();
    expect(screen.getByText('Loading data from exchange…')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'New strategy' }) as HTMLButtonElement).disabled).toBe(true);
    resolveFirst(json(200, list(items)));
    expect(await screen.findByText('BTCUSDT')).toBeTruthy();
    expect(await screen.findByText('S-01')).toBeTruthy();
  });

  it('shows the empty state and opens the form from its button', async () => {
    mockFetch((pathname, method) => {
      if (pathname === '/v1/strategies' && method === 'GET') return json(200, list([]));
      if (pathname === '/v1/strategies/sizing-preview' && method === 'GET') return json(200, preview);
      return json(404, {});
    });
    renderStrategies();
    expect(await screen.findByText('No strategies yet')).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'New strategy' });
    const emptyButton = buttons[buttons.length - 1]; // the one in the empty state
    if (!emptyButton) throw new Error('button not found');
    fireEvent.click(emptyButton);
    expect(await screen.findByRole('heading', { name: 'New strategy' })).toBeTruthy();
  });

  it('shows the unreachable banner when the exchange is down', async () => {
    mockFetch((pathname, method) => {
      if (pathname === '/v1/strategies' && method === 'GET') return json(200, list([], { exchangeError: 'unreachable' }));
      return json(404, {});
    });
    renderStrategies();
    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain('Exchange unreachable');
  });

  it('enables a disabled strategy with a fresh TOTP code', async () => {
    const s02 = item({ id: 'S-02', pair: 'BTCUSDT', status: 'disabled' });
    const fn = mockFetch((pathname, method) => {
      if (pathname === '/v1/strategies' && method === 'GET') return json(200, list([s02]));
      if (pathname === '/v1/strategies/S-02/enable' && method === 'POST') return json(200, { id: 'S-02', status: 'enabled' });
      return json(404, {});
    });
    const { onEnabled } = renderStrategies();
    fireEvent.click(await screen.findByRole('button', { name: 'Enable' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Enable S-02?' })).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Two-factor code'), { target: { value: '123456' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enable' }));
    expect(await screen.findByText('S-02 enabled')).toBeTruthy();
    expect(onEnabled).toHaveBeenCalledTimes(1);
    const call = fn.mock.calls.find(([input, init]) => String(input).includes('/v1/strategies/S-02/enable') && init?.method === 'POST');
    expect(call).toBeTruthy();
    expect((call![1]!.headers as Record<string, string>)['x-totp-code']).toBe('123456');
  });

  it('keeps the enable dialog open and shows the rejection text on 403', async () => {
    const s02 = item({ id: 'S-02', pair: 'BTCUSDT', status: 'disabled' });
    mockFetch((pathname, method) => {
      if (pathname === '/v1/strategies' && method === 'GET') return json(200, list([s02]));
      if (pathname === '/v1/strategies/S-02/enable' && method === 'POST') return json(403, { message: 'bad code' });
      return json(404, {});
    });
    renderStrategies();
    fireEvent.click(await screen.findByRole('button', { name: 'Enable' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Two-factor code'), { target: { value: '123456' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enable' }));
    expect(await screen.findByText('Code not accepted. Wait for the next code and try again.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('blocks enabling when another strategy on the pair is enabled', async () => {
    const s01 = item({ id: 'S-01', pair: 'BTCUSDT', status: 'enabled' });
    const s02 = item({ id: 'S-02', pair: 'BTCUSDT', status: 'disabled' });
    const fn = mockFetch((pathname, method) => {
      if (pathname === '/v1/strategies' && method === 'GET') return json(200, list([s01, s02]));
      return json(404, {});
    });
    renderStrategies();
    const rowEl = (await screen.findByText('S-02')).closest('.gt-row');
    if (!rowEl) throw new Error('row not found');
    const row = rowEl as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Enable' }));
    expect(await screen.findByText('BTCUSDT already has an enabled strategy: S-01. Disable it first.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fn.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('disables an enabled strategy that still has a position', async () => {
    const s01 = item({ id: 'S-01', pair: 'BTCUSDT', status: 'enabled', position });
    const fn = mockFetch((pathname, method) => {
      if (pathname === '/v1/strategies' && method === 'GET') return json(200, list([s01]));
      if (pathname === '/v1/strategies/S-01/disable' && method === 'POST') return json(200, { id: 'S-01', status: 'disabled' });
      return json(404, {});
    });
    renderStrategies();
    fireEvent.click(await screen.findByRole('button', { name: 'Disable' }));
    expect(await screen.findByText('S-01 disabled · still managing its open position')).toBeTruthy();
    expect(fn.mock.calls.some(([input, init]) => String(input).includes('/v1/strategies/S-01/disable') && init?.method === 'POST')).toBe(true);
  });

  it('closes a strategy with no position at market', async () => {
    const s03 = item({ id: 'S-03', pair: 'BTCUSDT', status: 'enabled' });
    const fn = mockFetch((pathname, method) => {
      if (pathname === '/v1/strategies' && method === 'GET') return json(200, list([s03]));
      if (pathname === '/v1/strategies/S-03/close' && method === 'POST') return json(200, { id: 'S-03', status: 'closed' });
      return json(404, {});
    });
    renderStrategies();
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Close BTCUSDT position?' })).toBeTruthy();
    expect(within(dialog).getByText('This marks the strategy as closed. Its trade history is kept.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(await screen.findByText('BTCUSDT closed at market')).toBeTruthy();
    expect(fn.mock.calls.some(([input, init]) => String(input).includes('/v1/strategies/S-03/close') && init?.method === 'POST')).toBe(true);
  });

  it('keeps the close dialog open when the server answers position_open', async () => {
    const s01 = item({ id: 'S-01', pair: 'BTCUSDT', status: 'enabled', position });
    mockFetch((pathname, method) => {
      if (pathname === '/v1/strategies' && method === 'GET') return json(200, list([s01]));
      if (pathname === '/v1/strategies/S-01/close' && method === 'POST') return json(409, { code: 'position_open', message: 'open position' });
      return json(404, {});
    });
    renderStrategies();
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Market close: Long 0.050 @ 61,240.00')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close at market' }));
    expect(await screen.findByText('S-01 has an open position. It cannot be closed from here yet; use the kill switch.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('creates a strategy from the form', async () => {
    const s01 = item({ id: 'S-01', pair: 'BTCUSDT', status: 'enabled' });
    const fn = mockFetch((pathname, method) => {
      if (pathname === '/v1/strategies' && method === 'GET') return json(200, list([s01]));
      if (pathname === '/v1/strategies/sizing-preview' && method === 'GET') return json(200, preview);
      if (pathname === '/v1/strategies' && method === 'POST') return json(201, { id: 'S-09', status: 'disabled' });
      return json(404, {});
    });
    renderStrategies();
    fireEvent.click(await screen.findByRole('button', { name: 'New strategy' }));
    await screen.findByRole('heading', { name: 'New strategy' });
    // Debounced preview (300 ms) resolves while the form is open.
    expect(await screen.findByText('With 10,000.00 USDT and 5x: 10% → notional 10,000.00, margin 2,000.00')).toBeTruthy();

    expect(saveButton().disabled).toBe(true); // pair still empty
    const pair = screen.getByLabelText('Pair') as HTMLInputElement;
    fireEvent.change(pair, { target: { value: 'btcusdt' } });
    expect(pair.value).toBe('BTCUSDT');
    // 'BTCUSDT' clashes with the enabled S-01, so use a free pair to check the enabled state.
    fireEvent.change(pair, { target: { value: 'ETHUSDT' } });
    expect(saveButton().disabled).toBe(false);

    fireEvent.change(pair, { target: { value: 'FOO' } });
    expect(screen.getByText('Enter a USDT pair such as BTCUSDT.')).toBeTruthy();
    expect(saveButton().disabled).toBe(true);

    fireEvent.change(pair, { target: { value: 'BTCUSDT' } });
    expect(screen.getByText('BTCUSDT already has an enabled strategy: S-01 (Futures). Disable it first.')).toBeTruthy();

    fireEvent.change(pair, { target: { value: 'ETHUSDT' } });
    fireEvent.click(saveButton());
    expect(await screen.findByText('Strategy saved')).toBeTruthy();
    expect(await screen.findByText('S-01')).toBeTruthy();

    const call = fn.mock.calls.find(([input, init]) => String(input) === '/v1/strategies' && init?.method === 'POST');
    expect(call).toBeTruthy();
    expect(JSON.parse(String(call![1]!.body))).toEqual({
      pair: 'ETHUSDT',
      market: 'futures',
      leverage: 5,
      sizingMode: 'B',
      marginMode: 'isolated',
      basePct: '10',
      confidenceThreshold: '0.7',
      riskPct: null,
    });
  });

  it('hides leverage and margin mode for spot and omits them from the payload', async () => {
    const fn = mockFetch((pathname, method) => {
      if (pathname === '/v1/strategies' && method === 'GET') return json(200, list([]));
      if (pathname === '/v1/strategies/sizing-preview' && method === 'GET') return json(200, preview);
      if (pathname === '/v1/strategies' && method === 'POST') return json(201, { id: 'S-10', status: 'disabled' });
      return json(404, {});
    });
    renderStrategies();
    fireEvent.click(await screen.findByRole('button', { name: 'New strategy' }));
    await screen.findByRole('heading', { name: 'New strategy' });

    expect(screen.getAllByRole('slider')).toHaveLength(2); // leverage + base size
    expect(screen.getByRole('group', { name: 'Margin mode' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Pair') as HTMLInputElement, { target: { value: 'ETHUSDT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spot' }));
    expect(screen.getAllByRole('slider')).toHaveLength(1);
    expect(screen.queryByRole('group', { name: 'Margin mode' })).toBeNull();

    fireEvent.click(saveButton());
    expect(await screen.findByText('Strategy saved')).toBeTruthy();
    const call = fn.mock.calls.find(([input, init]) => String(input) === '/v1/strategies' && init?.method === 'POST');
    expect(JSON.parse(String(call![1]!.body))).toMatchObject({ market: 'spot', leverage: null, marginMode: null, sizingMode: 'B' });
  });

  it('locks pair, market, leverage and margin mode while a position is open', async () => {
    const s01 = item({ id: 'S-01', pair: 'BTCUSDT', status: 'enabled', position, locked: true });
    const fn = mockFetch((pathname, method) => {
      if (pathname === '/v1/strategies' && method === 'GET') return json(200, list([s01]));
      if (pathname === '/v1/strategies/sizing-preview' && method === 'GET') return json(200, preview);
      if (pathname === '/v1/strategies/S-01' && method === 'PATCH') return json(200, { id: 'S-01' });
      return json(404, {});
    });
    renderStrategies();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('heading', { name: 'Edit strategy · S-01' })).toBeTruthy();
    expect((screen.getByLabelText('Pair') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Futures' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Leverage and margin mode are locked while S-01 has an open position. They can change after the position closes.')).toBeTruthy();

    fireEvent.click(saveButton());
    expect(await screen.findByText('Strategy saved')).toBeTruthy();
    const call = fn.mock.calls.find(([input, init]) => String(input) === '/v1/strategies/S-01' && init?.method === 'PATCH');
    expect(call).toBeTruthy();
    const body = JSON.parse(String(call![1]!.body)) as Record<string, unknown>;
    expect(body).toEqual({ sizingMode: 'B', basePct: '10', confidenceThreshold: '0.7', riskPct: null });
    expect('pair' in body).toBe(false);
    expect('market' in body).toBe(false);
    expect('leverage' in body).toBe(false);
    expect('marginMode' in body).toBe(false);
  });

  it('shows the locked-field error when the server rejects the edit', async () => {
    const s01 = item({ id: 'S-01', pair: 'BTCUSDT', status: 'enabled', position, locked: true });
    mockFetch((pathname, method) => {
      if (pathname === '/v1/strategies' && method === 'GET') return json(200, list([s01]));
      if (pathname === '/v1/strategies/sizing-preview' && method === 'GET') return json(200, preview);
      if (pathname === '/v1/strategies/S-01' && method === 'PATCH') return json(409, { code: 'locked_field', message: 'locked' });
      return json(404, {});
    });
    renderStrategies();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await screen.findByRole('heading', { name: 'Edit strategy · S-01' });
    fireEvent.click(saveButton());
    expect(await screen.findByText('This field cannot change while the strategy has an open position.')).toBeTruthy();
  });
});
