import { Decimal } from 'decimal.js';

const W = 96;
const H = 32;
const X_MIN = 2;
const X_MAX = 94;
const Y_TOP = 4; // highest value maps here
const Y_BOTTOM = 28; // lowest value maps here

/**
 * A 30-day PnL sparkline as inline SVG. `total` (the signed 30-day total)
 * decides the stroke colour; `values` (oldest first) are the daily points.
 */
export function Sparkline({ values, total }: { values: string[]; total: string }) {
  const t = new Decimal(total);
  const stroke = t.isZero() ? 'var(--text-muted)' : t.isNegative() ? 'var(--sparkline-down)' : 'var(--sparkline-up)';

  let points = '';
  let zeroY = (Y_TOP + Y_BOTTOM) / 2;
  if (values.length >= 2) {
    // Decimal min/max; 0 is always in the range so the zero line stays in view.
    let min = new Decimal(0);
    let max = new Decimal(0);
    for (const v of values) {
      const d = new Decimal(v);
      if (d.lt(min)) min = d;
      if (d.gt(max)) max = d;
    }
    const span = max.sub(min);
    const step = (X_MAX - X_MIN) / (values.length - 1);
    const yFor = (v: string) => {
      if (span.isZero()) return (Y_TOP + Y_BOTTOM) / 2;
      // toNumber() only for the final pixel coordinate.
      return Y_BOTTOM - new Decimal(v).sub(min).mul(Y_BOTTOM - Y_TOP).div(span).toNumber();
    };
    zeroY = yFor('0');
    points = values.map((v, i) => `${(X_MIN + i * step).toFixed(2)},${yFor(v).toFixed(2)}`).join(' ');
  }

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="30-day PnL">
      <line x1={X_MIN} y1={zeroY} x2={X_MAX} y2={zeroY} stroke="var(--border-strong)" strokeDasharray="2 3" />
      {points ? (
        <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      ) : null}
    </svg>
  );
}
