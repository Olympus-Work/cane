import { BadRequestException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { BASE_PCT_MAX, BASE_PCT_MIN, MAX_LEVERAGE } from '@cane/core';
import { MARGIN_MODES, MARKETS, SIZING_MODES } from '../db/schema.js';

export type StrategyMarket = (typeof MARKETS)[number];
export type StrategySizingMode = (typeof SIZING_MODES)[number];
export type StrategyMarginMode = (typeof MARGIN_MODES)[number];

/** The user-editable fields of a strategy (B10.1), in the shape the `strategies` table stores. */
export interface StrategyFields {
  pair: string;
  market: StrategyMarket;
  leverage: number | null;
  sizingMode: StrategySizingMode;
  marginMode: StrategyMarginMode | null;
  basePct: string;
  confidenceThreshold: string;
  riskPct: string | null;
}

export const DEFAULTS = { leverage: 5, sizingMode: 'B', marginMode: 'isolated', basePct: '10', confidenceThreshold: '0.70', riskPct: '2' } as const;
const RISK_PCT_MAX = 100;

const bad = (code: string, message: string): never => {
  throw new BadRequestException({ code, message });
};

const obj = (body: unknown): Record<string, unknown> => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return bad('bad_body', 'A JSON object is required');
  return body as Record<string, unknown>;
};

const oneOf = <T extends string>(field: string, v: unknown, set: readonly T[]): T =>
  typeof v === 'string' && (set as readonly string[]).includes(v) ? (v as T) : bad(`bad_${field}`, `${field} must be one of ${set.join(', ')}`);

function decimal(field: string, v: unknown, min: number, max: number): string {
  if (typeof v !== 'string' && typeof v !== 'number') return bad(`bad_${field}`, `${field} must be a number`);
  let d: Decimal;
  try {
    d = new Decimal(v);
  } catch {
    return bad(`bad_${field}`, `${field} must be a number`);
  }
  if (!d.isFinite() || d.lt(min) || d.gt(max)) return bad(`bad_${field}`, `${field} must be between ${min} and ${max}`);
  return d.toFixed();
}

/** A pair such as `BTCUSDT`; only USDT-quoted pairs are allowed (B10.6). */
function pairOf(v: unknown): string {
  const p = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return /^[A-Z0-9]{1,20}USDT$/.test(p) && p !== 'USDT' ? p : bad('bad_pair', 'pair must be a USDT pair such as BTCUSDT');
}

/** Type-checks the fields present in an edit body; consistency across fields is `validateFields`' job. */
export function parsePatch(body: unknown): Partial<StrategyFields> {
  const b = obj(body);
  const out: Partial<StrategyFields> = {};
  if (b.pair !== undefined) out.pair = pairOf(b.pair);
  if (b.market !== undefined) out.market = oneOf('market', b.market, MARKETS);
  if (b.sizingMode !== undefined) out.sizingMode = oneOf('sizingMode', b.sizingMode, SIZING_MODES);
  if (b.marginMode !== undefined) out.marginMode = b.marginMode === null ? null : oneOf('marginMode', b.marginMode, MARGIN_MODES);
  if (b.leverage !== undefined) {
    if (b.leverage !== null && (typeof b.leverage !== 'number' || !Number.isInteger(b.leverage))) bad('bad_leverage', 'leverage must be a whole number');
    out.leverage = b.leverage as number | null;
  }
  if (b.basePct !== undefined) out.basePct = decimal('basePct', b.basePct, BASE_PCT_MIN, BASE_PCT_MAX);
  if (b.confidenceThreshold !== undefined) out.confidenceThreshold = decimal('confidenceThreshold', b.confidenceThreshold, 0, 1);
  if (b.riskPct !== undefined) out.riskPct = b.riskPct === null ? null : decimal('riskPct', b.riskPct, 0, RISK_PCT_MAX);
  const known = ['pair', 'market', 'sizingMode', 'marginMode', 'leverage', 'basePct', 'confidenceThreshold', 'riskPct'];
  const unknown = Object.keys(b).find((k) => !known.includes(k));
  if (unknown) bad('unknown_field', `${unknown} cannot be set`);
  return out;
}

/** B10.1 defaults for a create body: futures, 5x, isolated, mode B, base 10 %, threshold 0.70, risk 2 % (mode C). */
export function parseCreate(body: unknown): StrategyFields {
  const p = parsePatch(body);
  if (p.pair === undefined) bad('bad_pair', 'pair is required');
  const market = p.market ?? 'futures';
  const sizingMode = p.sizingMode ?? DEFAULTS.sizingMode;
  const spot = market === 'spot';
  return validateFields({
    pair: p.pair as string,
    market,
    leverage: spot ? (p.leverage ?? null) : (p.leverage ?? DEFAULTS.leverage),
    sizingMode,
    marginMode: spot ? (p.marginMode ?? null) : (p.marginMode ?? DEFAULTS.marginMode),
    basePct: p.basePct ?? DEFAULTS.basePct,
    confidenceThreshold: p.confidenceThreshold ?? DEFAULTS.confidenceThreshold,
    riskPct: sizingMode === 'C' ? (p.riskPct ?? DEFAULTS.riskPct) : (p.riskPct ?? null),
  });
}

/** Cross-field rules that mirror the table CHECKs, so a bad body is a 400 and never a database error. */
export function validateFields(f: StrategyFields): StrategyFields {
  if (f.market === 'spot') {
    if (f.leverage !== null || f.marginMode !== null) bad('spot_no_leverage', 'Spot has no leverage or margin mode');
    if (f.sizingMode !== 'B') bad('spot_sizing_mode', 'Spot supports sizing mode B only');
  } else {
    if (f.leverage === null || !Number.isInteger(f.leverage) || f.leverage < 1 || f.leverage > MAX_LEVERAGE) {
      bad('bad_leverage', `leverage must be a whole number from 1 to ${MAX_LEVERAGE}`);
    }
    if (f.marginMode === null) bad('bad_marginMode', 'Futures need a margin mode');
  }
  if (f.sizingMode === 'C') {
    if (f.riskPct === null || new Decimal(f.riskPct).lte(0)) bad('bad_riskPct', 'Mode C needs riskPct above 0');
  } else if (f.riskPct !== null) {
    bad('risk_pct_mode_c_only', 'riskPct applies to sizing mode C only');
  }
  return f;
}
