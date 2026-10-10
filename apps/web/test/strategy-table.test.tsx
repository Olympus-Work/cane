import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { StrategyItem } from '../src/api';
import { I18nProvider } from '../src/i18n/index';
import { StrategyTable } from '../src/components/StrategyTable';
import { afterEach, describe, expect, it, vi } from 'vitest';

function wrap(ui: ReactElement) {
  return <I18nProvider initial="en">{ui}</I18nProvider>;
}

function item(overrides: Partial<StrategyItem> & Pick<StrategyItem, 'id' | 'pair' | 'status'>): StrategyItem {
  return {
    market: 'futures',
    attentionReason: null,
    sizingMode: 'A',
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

const inPos = item({
  id: 'btc-fut-1',
  pair: 'BTCUSDT',
  status: 'enabled',
  price: '61240.5',
  change24hPct: '1.25',
  leverageInUse: 3,
  position: {
    side: 'long',
    qty: '0.05',
    entryPrice: '61240',
    stopPrice: '59000',
    takeProfitPrice: null,
    leverage: 3,
    openedAt: '2026-09-24T02:00:00Z',
    unrealizedPnl: '12.5',
  },
  pnl30d: { total: '150.25', daily: [{ day: '2026-09-20', pnl: '10' }, { day: '2026-09-21', pnl: '5' }] },
});

const waiting = item({
  id: 'eth-fut-2',
  pair: 'ETHUSDT',
  status: 'enabled',
  sizingMode: 'B',
  marginMode: 'cross',
  leverageCeiling: 10,
  price: '3450.25',
  change24hPct: '-0.75',
  pnl30d: { total: '-20.5', daily: [{ day: '2026-09-20', pnl: '-5' }, { day: '2026-09-21', pnl: '-5' }] },
});

const disabled = item({
  id: 'sol-spot-3',
  pair: 'SOLUSDT',
  status: 'disabled',
  market: 'spot',
  marginMode: null,
  leverageCeiling: null,
  price: '152.4',
});

const closed = item({
  id: 'xrp-fut-4',
  pair: 'XRPUSDT',
  status: 'closed',
  sizingMode: 'C',
  price: '2.35',
  change24hPct: '0.1',
  pnl30d: { total: '-5', daily: [] },
});

const attention = item({
  id: 'doge-fut-5',
  pair: 'DOGEUSDT',
  status: 'needs_attention',
  attentionReason: 'Stop order missing — re-placed',
  price: '0.1234',
  change24hPct: '2.5',
  pnl30d: { total: '10', daily: [] },
});

const items = [inPos, waiting, disabled, closed, attention];

const actions = {
  onEnable: vi.fn(),
  onDisable: vi.fn(),
  onEdit: vi.fn(),
  onClose: vi.fn(),
};

function rowOf(pair: string): HTMLElement {
  return screen.getByText(pair).closest('.gt-row') as HTMLElement;
}

describe('StrategyTable', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the state label and position summary for every status', () => {
    render(wrap(<StrategyTable items={items} actions={actions} />));
    expect(screen.getByText('In position')).toBeTruthy();
    expect(screen.getByText('Waiting for signal')).toBeTruthy();
    expect(screen.getByText('Disabled')).toBeTruthy();
    expect(screen.getByText('Closed')).toBeTruthy();
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText('Long 0.050 @ 61,240.00')).toBeTruthy();
    expect(screen.getByText('Futures · A · margin · 5x (3x) · Isolated')).toBeTruthy();
  });

  it('puts the settings on the second line; spot shows the market only', () => {
    render(wrap(<StrategyTable items={items} actions={actions} />));
    expect(within(rowOf('ETHUSDT')).getByText('Futures · B · notional · 10x · Cross').className).toContain('strat-meta');
    expect(within(rowOf('SOLUSDT')).getByText('Spot').className).toContain('strat-meta');
  });

  it('colours the 24h change with the pnl class and sign, never colour alone', () => {
    render(wrap(<StrategyTable items={items} actions={actions} />));
    const up = within(rowOf('BTCUSDT')).getByText('+1.25%');
    expect(up.className).toContain('pnl-up');
    const down = within(rowOf('ETHUSDT')).getByText('−0.75%');
    expect(down.className).toContain('pnl-down');
  });

  it('renders the right buttons per state: closed has none, disabled has Enable but not Disable', () => {
    render(wrap(<StrategyTable items={items} actions={actions} />));
    expect(within(rowOf('XRPUSDT')).queryAllByRole('button')).toHaveLength(0);
    const disabledRow = rowOf('SOLUSDT');
    expect(within(disabledRow).getByRole('button', { name: 'Enable' })).toBeTruthy();
    expect(within(disabledRow).queryByRole('button', { name: 'Disable' })).toBeNull();
    const enabledRow = rowOf('BTCUSDT');
    expect(within(enabledRow).getByRole('button', { name: 'Disable' })).toBeTruthy();
    expect(within(enabledRow).queryByRole('button', { name: 'Enable' })).toBeNull();
    expect(within(rowOf('DOGEUSDT')).getByRole('button', { name: 'Disable' })).toBeTruthy();
  });

  it('calls the matching action with the item on click', () => {
    render(wrap(<StrategyTable items={items} actions={actions} />));
    fireEvent.click(within(rowOf('SOLUSDT')).getByRole('button', { name: 'Enable' }));
    expect(actions.onEnable).toHaveBeenCalledWith(disabled);

    fireEvent.click(within(rowOf('BTCUSDT')).getByRole('button', { name: 'Disable' }));
    expect(actions.onDisable).toHaveBeenCalledWith(inPos);

    fireEvent.click(within(rowOf('ETHUSDT')).getByRole('button', { name: 'Edit' }));
    expect(actions.onEdit).toHaveBeenCalledWith(waiting);

    fireEvent.click(within(rowOf('BTCUSDT')).getByRole('button', { name: 'Close' }));
    expect(actions.onClose).toHaveBeenCalledWith(inPos);
  });

  it('shows the needs_attention reason under the badge', () => {
    render(wrap(<StrategyTable items={items} actions={actions} />));
    expect(within(rowOf('DOGEUSDT')).getByText('Stop order missing — re-placed')).toBeTruthy();
  });
});
