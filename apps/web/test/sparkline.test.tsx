import { cleanup, render } from '@testing-library/react';
import { Sparkline } from '../src/components/Sparkline';
import { afterEach, describe, expect, it } from 'vitest';

// 30 daily PnL values, oldest first.
const THIRTY = Array.from({ length: 30 }, (_, i) => `${(i - 15) * 0.5}`);

describe('Sparkline', () => {
  afterEach(() => cleanup());

  it('renders a polyline with 30 points', () => {
    const { container } = render(<Sparkline values={THIRTY} total="12.5" />);
    const polyline = container.querySelector('polyline');
    expect(polyline).toBeTruthy();
    const points = (polyline as SVGPolylineElement).getAttribute('points')!;
    expect(points.split(' ').length).toBe(30);
  });

  it('uses the up variable for a positive total', () => {
    const { container } = render(<Sparkline values={THIRTY} total="12.5" />);
    expect((container.querySelector('polyline') as SVGPolylineElement).getAttribute('stroke')).toBe('var(--sparkline-up)');
  });

  it('uses the down variable for a negative total', () => {
    const { container } = render(<Sparkline values={THIRTY} total="-3" />);
    expect((container.querySelector('polyline') as SVGPolylineElement).getAttribute('stroke')).toBe('var(--sparkline-down)');
  });

  it('uses the muted variable for a zero total', () => {
    const { container } = render(<Sparkline values={THIRTY} total="0" />);
    expect((container.querySelector('polyline') as SVGPolylineElement).getAttribute('stroke')).toBe('var(--text-muted)');
  });

  it('renders no polyline with fewer than 2 values', () => {
    const { container } = render(<Sparkline values={['1.5']} total="1.5" />);
    expect(container.querySelector('polyline')).toBeNull();
    // The zero line is still drawn.
    expect(container.querySelector('line')).toBeTruthy();
  });

  it('does not produce NaN for equal values', () => {
    const { container } = render(<Sparkline values={['5', '5', '5', '5']} total="0" />);
    const points = (container.querySelector('polyline') as SVGPolylineElement).getAttribute('points')!;
    expect(points).not.toContain('NaN');
  });
});
