import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nProvider } from '../src/i18n/index';
import { PositionCards } from '../src/components/PositionCards';
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
  markPrice: null,
  change24hPct: null,
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

describe('PositionCards', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders nothing for an empty list', () => {
    const { container } = render(wrap(<PositionCards positions={[]} />));
    expect(container.querySelector('.position-card')).toBeNull();
  });

  it('renders both positions with correct pair texts', () => {
    render(wrap(<PositionCards positions={[futures, spot]} />));
    expect(screen.getByText('BTCUSDT')).toBeTruthy();
    expect(screen.getByText('SOLUSDT')).toBeTruthy();
  });

  it('shows positive PnL with the up class and the percentage below', () => {
    const { container } = render(wrap(<PositionCards positions={[futures, spot]} />));
    const up = Array.from(container.querySelectorAll<HTMLElement>('.pnl-up')).find((el) => el.textContent?.trim() === '+12.50');
    expect(up).toBeTruthy();
    const pct = Array.from(container.querySelectorAll<HTMLElement>('.position-card-pnl-pct.pnl-up')).find((el) => el.textContent?.trim() === '+2.05%');
    expect(pct).toBeTruthy();
  });

  it('shows negative PnL with the U+2212 minus and the down class', () => {
    const { container } = render(wrap(<PositionCards positions={[futures, spot]} />));
    const down = Array.from(container.querySelectorAll<HTMLElement>('.pnl-down')).find((el) => el.textContent?.trim() === '−7.25');
    expect(down).toBeTruthy();
  });

  it('shows 5x only on the futures card', () => {
    const { container } = render(wrap(<PositionCards positions={[futures, spot]} />));
    const cards = Array.from(container.querySelectorAll<HTMLElement>('.position-card'));
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain('5x');
    expect(cards[1]!.textContent).not.toContain('5x');
  });

  it('shows an em dash for the null mark price', () => {
    const { container } = render(wrap(<PositionCards positions={[futures, spot]} />));
    const cards = Array.from(container.querySelectorAll<HTMLElement>('.position-card'));
    const spotValues = Array.from(cards[1]!.querySelectorAll<HTMLElement>('.position-card-value'));
    expect(spotValues[1]!.textContent).toBe('—');
  });

  it('shows the Entry, Mark and Stop labels on every card', () => {
    const { container } = render(wrap(<PositionCards positions={[futures, spot]} />));
    const cards = Array.from(container.querySelectorAll<HTMLElement>('.position-card'));
    for (const card of cards) {
      const labels = Array.from(card.querySelectorAll<HTMLElement>('.position-card-label')).map((el) => el.textContent);
      expect(labels).toEqual(['Entry', 'Mark', 'Stop']);
    }
  });
});
