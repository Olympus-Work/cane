import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nProvider } from '../src/i18n/index.js';
import { ThemeProvider } from '../src/theme.js';
import { TradeDrawer } from '../src/components/TradeDrawer.js';
import type { TradeDetail } from '../src/api.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

function wrap(ui: ReactElement) {
  return (
    <I18nProvider initial="en">
      <ThemeProvider>{ui}</ThemeProvider>
    </I18nProvider>
  );
}

function makeTrade(overrides: Partial<TradeDetail>): TradeDetail {
  return {
    id: 42,
    strategyId: 's1',
    pair: 'BTCUSDT',
    market: 'futures',
    side: 'long',
    entryPrice: '61240.5',
    exitPrice: '61300',
    qty: '0.01',
    netPnl: '10.30',
    exitReason: 'take_profit',
    openedAt: '2025-01-01T00:00:00Z',
    closedAt: '2025-01-01T06:00:00Z',
    entryKind: 'primary',
    signalTimeframe: '1D',
    trend1w: 'up',
    factors: [
      { name: 'channel_breakout', confidence: '0.8', present: true, counted: true },
      { name: 'capitulation', confidence: '0.6', present: true, counted: true },
      { name: 'higher_low', confidence: '0.2', present: false, counted: false },
    ],
    threshold: '0.70',
    jevFallback: false,
    sizingMode: 'A',
    sizePct: '2',
    leverage: { configured: 5, used: 3, lowered: true },
    pnl: { gross: '12.00', fees: '1.50', funding: '-0.20', net: '10.30' },
    ...overrides,
  };
}

describe('TradeDrawer', () => {
  afterEach(cleanup);

  it('renders a long futures trade with factors, lowered leverage and PnL', () => {
    render(wrap(<TradeDrawer trade={makeTrade({})} onClose={() => undefined} />));

    expect(screen.getByRole('heading', { name: 'BTCUSDT · Futures · Long' })).toBeTruthy();
    expect(screen.getByText('T-42')).toBeTruthy();

    // 2 of the 3 factors are present.
    expect(screen.getAllByText('Present')).toHaveLength(2);
    expect(screen.getAllByText('Not present')).toHaveLength(1);
    // Factor codes from the server are shown with their translated, side-specific names.
    expect(screen.getByText('Channel breakout')).toBeTruthy();
    expect(screen.getByText('Capitulation')).toBeTruthy();
    expect(screen.getByText('Higher low')).toBeTruthy();

    // Leverage lowered from 5 to 3.
    expect(screen.getByText(/lowered from 5 to 3/)).toBeTruthy();

    // Net row is emphasised, positive and signed.
    const netRow = screen.getByText('+10.30').closest('.drawer-box-net') as HTMLElement;
    expect(netRow).toBeTruthy();
    expect(netRow.className).toContain('pnl-up');
    expect(netRow.querySelector('.fa-caret-up')).toBeTruthy();
  });

  it('backdrop click and Escape both call onClose', () => {
    const onClose = vi.fn();
    render(wrap(<TradeDrawer trade={makeTrade({})} onClose={onClose} />));

    fireEvent.click(document.querySelector('.drawer-backdrop') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('a late spot trade without factors shows the late note and em dashes for leverage and funding', () => {
    render(
      wrap(
        <TradeDrawer
          trade={makeTrade({
            market: 'spot',
            entryKind: 'late',
            factors: null,
            leverage: { configured: null, used: null, lowered: false },
            pnl: { gross: '5.00', fees: '0.50', funding: '0', net: '4.50' },
          })}
          onClose={() => undefined}
        />,
      ),
    );

    expect(screen.getByText('Late entries use base size only. No confluence bonus.')).toBeTruthy();
    // Leverage and funding rows both show an em dash.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    const levRow = screen.getByText('Leverage used').closest('.drawer-box-row');
    expect(levRow?.textContent).toContain('—');
    const fundingRow = screen.getByText('Funding').closest('.drawer-box-row');
    expect(fundingRow?.textContent).toContain('—');
  });

  it('a Jev fallback trade without factors shows the badge and the note with the default 3 s timeout', () => {
    render(
      wrap(<TradeDrawer trade={makeTrade({ factors: null, jevFallback: true })} onClose={() => undefined} />),
    );

    expect(screen.getByText('Jev fallback: base size')).toBeTruthy();
    expect(screen.getByText('Jev did not answer within 3 s. All factors treated as not present.')).toBeTruthy();
  });

  it('a short flip trade shows the flip panel with the flip title and no link', () => {
    render(
      wrap(
        <TradeDrawer
          trade={makeTrade({ side: 'short', entryKind: 'flip', factors: null, exitReason: 'flip' })}
          onClose={() => undefined}
        />,
      ),
    );

    // The drawer portals into document.body, outside the render container.
    const flip = document.querySelector('.drawer-flip') as HTMLElement;
    expect(flip).toBeTruthy();
    expect(flip.textContent).toContain('Flip');
    // The note names the closed long and the first red signal.
    expect(flip.textContent).toContain('Opened after a profitable long closed on first red.');
    expect(flip.textContent).toContain('0 of 3 short factors present');
    // The API has no id for the previous trade: no link is rendered.
    expect(flip.querySelector('a')).toBeNull();
    expect(document.querySelector('.drawer a')).toBeNull();
  });
});
