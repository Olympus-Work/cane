import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { HeatmapDay } from '../src/api';
import { ThemeProvider } from '../src/theme';
import { I18nProvider, type Lang } from '../src/i18n/index';
import { Heatmap } from '../src/components/Heatmap';
import { afterEach, describe, expect, it } from 'vitest';

function wrap(ui: ReactElement, initial: Lang = 'en') {
  return (
    <I18nProvider initial={initial}>
      <ThemeProvider>{ui}</ThemeProvider>
    </I18nProvider>
  );
}

// 2026-09-27 is a Sunday: 53 weeks = 371 slots, 365 real days, 6 pads after today.
const ITEMS: HeatmapDay[] = [
  { day: '2026-09-20', trades: 3, wins: 2, losses: 1, pnl: '12.50', level: 3 },
  { day: '2026-09-10', trades: 1, wins: 0, losses: 1, pnl: '-4.25', level: 1 },
  { day: '2026-09-15', trades: 0, wins: 0, losses: 0, pnl: '0', level: 0 },
];

describe('Heatmap card', () => {
  afterEach(cleanup);

  it('renders 365 cells and 6 pads for 53 weeks ending on a Sunday', () => {
    const { container } = render(wrap(<Heatmap items={ITEMS} today="2026-09-27" weeks={53} />));
    expect(container.querySelectorAll('.heatmap-cell')).toHaveLength(365);
    expect(container.querySelectorAll('.heatmap-pad')).toHaveLength(6);
  });

  it('applies the level class from the item and shows the 12-month range label', () => {
    const { container } = render(wrap(<Heatmap items={ITEMS} today="2026-09-27" weeks={53} />));
    expect(container.querySelector('.heatmap-cell[data-day="2026-09-20"]')?.className).toContain('heatmap-l3');
    expect(container.querySelector('.heatmap-cell[data-day="2026-09-10"]')?.className).toContain('heatmap-l1');
    expect(screen.getByText('last 12 months')).toBeTruthy();
  });

  it('summarises 2 non-adjacent active days in the footer', () => {
    render(wrap(<Heatmap items={ITEMS} today="2026-09-27" weeks={53} />));
    expect(screen.getByText('2 trading days out of 365 · longest streak 1 days')).toBeTruthy();
  });

  it('shows the tooltip on hover and removes it on mouse leave', () => {
    const { container } = render(wrap(<Heatmap items={ITEMS} today="2026-09-27" weeks={53} />));
    const cell = container.querySelector('.heatmap-cell[data-day="2026-09-20"]') as HTMLElement;
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(cell);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Sep 20, 2026 · Sunday');
    expect(tip.textContent).toContain('2W / 1L · 67%');
    expect(tip.querySelector('.pnl-up')).toBeTruthy();
    expect(cell.classList.contains('heatmap-cell-hot')).toBe(true);

    fireEvent.mouseLeave(cell);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('closes the tooltip when the heatmap or the page scrolls, or the window resizes', () => {
    const { container } = render(wrap(<Heatmap items={ITEMS} today="2026-09-27" weeks={53} />));
    const cell = container.querySelector('.heatmap-cell[data-day="2026-09-20"]') as HTMLElement;

    fireEvent.mouseEnter(cell);
    fireEvent.scroll(container.querySelector('.heatmap-scroll')!); // its own horizontal scroll
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(cell);
    fireEvent.scroll(window);
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(cell);
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('formats the tooltip header in Thai with the Buddhist calendar', () => {
    const { container } = render(wrap(<Heatmap items={ITEMS} today="2026-09-27" weeks={53} />, 'th'));
    const cell = container.querySelector('.heatmap-cell[data-day="2026-09-20"]') as HTMLElement;
    fireEvent.mouseEnter(cell);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('·');
    expect(tip.textContent).toContain('ก.ย.');
  });
});
