import { Decimal } from 'decimal.js';

const MINUS = '−'; // U+2212, not a hyphen

function groupIntPart(s: string): string {
  const [int = '', frac] = s.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac !== undefined ? `${grouped}.${frac}` : grouped;
}

export function fmtMoney(v: string | null, dp = 2): string {
  if (v === null) return '—';
  const d = new Decimal(v).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
  return groupIntPart(d.toFixed(dp));
}

export function fmtPrice(v: string | null): string {
  if (v === null) return '—';
  const abs = new Decimal(v).abs();
  const dp = abs.gte(100) ? 2 : abs.gte(1) ? 3 : 4;
  return fmtMoney(v, dp);
}

export function fmtQty(v: string | null): string {
  if (v === null) return '—';
  const d = new Decimal(v).abs().toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
  let s = d.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  if (s.includes('.')) {
    const [int = '', frac = ''] = s.split('.');
    s = `${int}.${frac.padEnd(3, '0')}`;
  }
  const sign = new Decimal(v).isNegative() ? '-' : '';
  return sign + groupIntPart(s);
}

export function signed(v: string, dp = 2): string {
  const d = new Decimal(v).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
  if (d.isZero()) return fmtMoney('0', dp);
  return d.isNegative() ? MINUS + fmtMoney(d.neg().toString(), dp) : '+' + fmtMoney(v, dp);
}

export function pnlDir(v: string | null): 'up' | 'down' | 'flat' {
  if (v === null) return 'flat';
  const d = new Decimal(v);
  return d.isZero() ? 'flat' : d.isNegative() ? 'down' : 'up';
}

export function fmtPct(v: string | null, dp = 2): string {
  if (v === null) return '—';
  return signed(v, dp) + '%';
}

const BKK = 'Asia/Bangkok';

export function bangkokDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BKK,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BKK,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date(iso))
    .replace(', ', ' ');
}

export function fmtClock(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BKK,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}
