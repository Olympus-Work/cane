import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nProvider } from '../src/i18n/index.js';
import { TradesTable } from '../src/components/TradesTable.js';
import type { TradeSummary } from '../src/api.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

function wrap(ui: ReactElement) {
  return <I18nProvider initial="en">{ui}</I18nProvider>;
}

function makeTrade(overrides: Partial<TradeSummary>): TradeSummary {
  return {
    id: 0,
    strategyId: 's1',
    pair: 'BTCUSDT',
    market: 'futures',
    side: 'long',
    entryPrice: '61240.5',
    exitPrice: '61300',
    qty: '0.01',
    netPnl: '0',
    exitReason: 'stop',
    openedAt: '2025-01-01T00:00:00Z',
    closedAt: '2025-01-01T06:00:00Z',
    ...overrides,
  };
}

const trades: TradeSummary[] = [
  makeTrade({ id: 11, exitReason: 'take_profit', netPnl: '12.34' }),
  makeTrade({ id: 12, exitReason: 'stop', netPnl: '-5.5' }),
  makeTrade({ id: 13, exitReason: 'first_green', netPnl: '0' }),
];

describe('TradesTable', () => {
  afterEach(cleanup);

  it('renders one button row per trade with the reason labels', () => {
    render(wrap(<TradesTable trades={trades} onOpen={() => undefined} />));
    const rows = screen.getAllByRole('button');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON']);
    const [tp, stop, green] = rows as [HTMLElement, HTMLElement, HTMLElement];
    expect(tp.textContent).toContain('Take-profit');
    expect(stop.textContent).toContain('Stop');
    expect(green.textContent).toContain('First green');
  });

  it('shows the PnL sign, icon and pnl class for each trade', () => {
    render(wrap(<TradesTable trades={trades} onOpen={() => undefined} />));
    const [tp, stop, green] = screen.getAllByRole('button') as [HTMLElement, HTMLElement, HTMLElement];
    expect(tp.querySelector('.pnl-up')).toBeTruthy();
    expect(tp.querySelector('.fa-caret-up')).toBeTruthy();
    expect(tp.textContent).toContain('+12.34');
    expect(stop.querySelector('.pnl-down')).toBeTruthy();
    expect(stop.querySelector('.fa-caret-down')).toBeTruthy();
    expect(stop.textContent).toContain('−5.50');
    expect(green.querySelector('.pnl-flat')).toBeTruthy();
    expect(green.querySelector('.fa-minus')).toBeTruthy();
  });

  it('clicking a row calls onOpen with that trade id', () => {
    const onOpen = vi.fn();
    render(wrap(<TradesTable trades={trades} onOpen={onOpen} />));
    const [, stop] = screen.getAllByRole('button') as [HTMLElement, HTMLElement, HTMLElement];
    fireEvent.click(stop);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(12);
  });

  it('renders nothing for an empty list', () => {
    const { container } = render(wrap(<TradesTable trades={[]} onOpen={() => undefined} />));
    expect(container.firstChild).toBeNull();
  });
});
