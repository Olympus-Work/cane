import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nProvider } from '../src/i18n/index';
import { PositionsTable } from '../src/components/PositionsTable';
import type { DashboardPosition } from '../src/api';
import { afterEach, describe, expect, it } from 'vitest';

const futures: DashboardPosition = {
  strategyId: 's1',
  sizingMode: 'A',
  pair: 'BTCUSDT',
  market: 'futures',
  side: 'long',
  qty: '0.5',
  entryPrice: '61000',
  markPrice: '61240.5',
  change24hPct: '1.2',
  unrealizedPnl: '12.50',
  unrealizedPnlPct: '2.05',
  stopPrice: '60000',
  takeProfitPrice: '63000',
  liquidationPrice: '55000',
  leverage: 5,
  openedAt: '2026-09-20T08:00:00Z',
};

const spot: DashboardPosition = {
  strategyId: 's2',
  sizingMode: 'B',
  pair: 'SOLUSDT',
  market: 'spot',
  side: 'short',
  qty: '10',
  entryPrice: '180',
  markPrice: '182.4',
  change24hPct: '-1.3',
  unrealizedPnl: '-7.25',
  unrealizedPnlPct: '-4.03',
  stopPrice: '185',
  takeProfitPrice: null,
  liquidationPrice: null,
  leverage: null,
  openedAt: '2026-09-21T09:30:00Z',
};

function wrap(ui: ReactElement) {
  return <I18nProvider initial="en">{ui}</I18nProvider>;
}

describe('PositionsTable', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders nothing for an empty list', () => {
    const { container } = render(wrap(<PositionsTable positions={[]} />));
    expect(container.querySelector('.positions-table')).toBeNull();
  });

  it('renders both positions with correct pair texts', () => {
    render(wrap(<PositionsTable positions={[futures, spot]} />));
    expect(screen.getByText('BTCUSDT')).toBeTruthy();
    expect(screen.getByText('SOLUSDT')).toBeTruthy();
  });

  it('shows positive PnL with the up icon and class', () => {
    const { container } = render(wrap(<PositionsTable positions={[futures, spot]} />));
    const up = Array.from(container.querySelectorAll<HTMLElement>('.pnl-up')).find((el) => el.textContent?.trim() === '+12.50 (+2.05%)');
    expect(up).toBeTruthy();
  });

  it('shows negative PnL with the U+2212 minus and the down class', () => {
    const { container } = render(wrap(<PositionsTable positions={[futures, spot]} />));
    const down = Array.from(container.querySelectorAll<HTMLElement>('.pnl-down')).find((el) => el.textContent?.trim() === '−7.25 (−4.03%)');
    expect(down).toBeTruthy();
  });

  it('shows an em dash for spot liq and leverage, and 5x for the futures row', () => {
    const { container } = render(wrap(<PositionsTable positions={[futures, spot]} />));
    const rows = Array.from(container.querySelectorAll<HTMLElement>('.gt-row'));
    const futuresRow = rows[0] as HTMLElement;
    const spotRow = rows[1] as HTMLElement;
    // liq and leverage are the 10th and 11th cells.
    const spotCells = Array.from(spotRow.querySelectorAll<HTMLElement>(':scope > span'));
    expect(spotCells[9]!.textContent).toBe('—');
    expect(spotCells[10]!.textContent).toBe('—');

    const futuresCells = Array.from(futuresRow.querySelectorAll<HTMLElement>(':scope > span'));
    expect(futuresCells[10]!.textContent).toBe('5x');
  });
});
