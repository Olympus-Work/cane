import { Decimal } from 'decimal.js';
import type { LeverageBracket, SymbolFilters } from '@cane/core';

/** Parsed per-symbol trading rules from a Binance exchangeInfo response. */
export interface SymbolInfo {
  symbol: string;
  status: string;
  filters: SymbolFilters;
}

type Filter = { filterType: string } & Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Locate the symbol entry in an exchangeInfo body and check its shape. */
function findSymbolEntry(body: unknown, symbol: string): { status: string; filters: Filter[] } {
  if (!isRecord(body) || !Array.isArray(body.symbols)) {
    throw new Error('Invalid exchangeInfo response');
  }
  const entry = body.symbols.find(
    (s) => isRecord(s) && s.symbol === symbol,
  );
  if (entry === undefined) {
    throw new Error(`Symbol not found in exchangeInfo: ${symbol}`);
  }
  if (typeof entry.status !== 'string') {
    throw new Error(`Invalid exchangeInfo status for ${symbol}`);
  }
  if (!Array.isArray(entry.filters)) {
    throw new Error(`Invalid exchangeInfo filters for ${symbol}`);
  }
  return { status: entry.status, filters: entry.filters as Filter[] };
}

function getFilter(filters: Filter[], filterType: string, symbol: string): Filter {
  const filter = filters.find((f) => f.filterType === filterType);
  if (filter === undefined) {
    throw new Error(`Missing exchangeInfo filter ${filterType} for ${symbol}`);
  }
  return filter;
}

/** Read a decimal string field from a filter, e.g. "0.00001000". */
function decimalField(
  filter: Filter,
  field: string,
  filterType: string,
  symbol: string,
): Decimal {
  const raw = filter[field];
  if (typeof raw !== 'string') {
    throw new Error(`Invalid exchangeInfo filter ${filterType}.${field} for ${symbol}`);
  }
  let value: Decimal;
  try {
    value = new Decimal(raw);
  } catch {
    throw new Error(`Invalid exchangeInfo filter ${filterType}.${field} for ${symbol}`);
  }
  if (!value.isFinite()) {
    throw new Error(`Invalid exchangeInfo filter ${filterType}.${field} for ${symbol}`);
  }
  return value;
}

/**
 * Shared parser for spot and futures exchangeInfo. The minimum-notional
 * filter differs: spot uses NOTIONAL.minNotional, futures uses
 * MIN_NOTIONAL.notional.
 */
function parseSymbol(
  body: unknown,
  symbol: string,
  minNotional: { filterType: string; field: string },
): SymbolInfo {
  const { status, filters } = findSymbolEntry(body, symbol);

  const tickSize = decimalField(
    getFilter(filters, 'PRICE_FILTER', symbol),
    'tickSize',
    'PRICE_FILTER',
    symbol,
  );
  if (!tickSize.gt(0)) {
    throw new Error(`Invalid exchangeInfo filter PRICE_FILTER.tickSize for ${symbol}`);
  }

  const lot = getFilter(filters, 'LOT_SIZE', symbol);
  let stepSize = decimalField(lot, 'stepSize', 'LOT_SIZE', symbol);
  let minQty = decimalField(lot, 'minQty', 'LOT_SIZE', symbol);

  // MARKET_LOT_SIZE may be missing; a zero value is ignored. The larger
  // (coarser) of the two filters wins.
  const marketLot = filters.find((f) => f.filterType === 'MARKET_LOT_SIZE');
  if (marketLot !== undefined) {
    const marketStep = decimalField(marketLot, 'stepSize', 'MARKET_LOT_SIZE', symbol);
    if (marketStep.gt(0) && marketStep.gt(stepSize)) {
      stepSize = marketStep;
    }
    const marketMin = decimalField(marketLot, 'minQty', 'MARKET_LOT_SIZE', symbol);
    if (marketMin.gt(0) && marketMin.gt(minQty)) {
      minQty = marketMin;
    }
  }
  if (!stepSize.gt(0)) {
    throw new Error(`Invalid exchangeInfo filter LOT_SIZE.stepSize for ${symbol}`);
  }
  if (!minQty.gte(0)) {
    throw new Error(`Invalid exchangeInfo filter LOT_SIZE.minQty for ${symbol}`);
  }

  const minNotionalValue = decimalField(
    getFilter(filters, minNotional.filterType, symbol),
    minNotional.field,
    minNotional.filterType,
    symbol,
  );
  if (!minNotionalValue.gte(0)) {
    throw new Error(`Invalid exchangeInfo filter ${minNotional.filterType}.${minNotional.field} for ${symbol}`);
  }

  return { symbol, status, filters: { stepSize, tickSize, minQty, minNotional: minNotionalValue } };
}

/** Parse one spot symbol from a spot exchangeInfo response. */
export function parseSpotSymbol(body: unknown, symbol: string): SymbolInfo {
  return parseSymbol(body, symbol, { filterType: 'NOTIONAL', field: 'minNotional' });
}

/** Parse one futures symbol from a USDⓈ-M futures exchangeInfo response. */
export function parseFuturesSymbol(body: unknown, symbol: string): SymbolInfo {
  return parseSymbol(body, symbol, { filterType: 'MIN_NOTIONAL', field: 'notional' });
}

/** Read a finite JSON number field from a leverage bracket row. */
function bracketNumber(row: Record<string, unknown>, field: string, symbol: string): Decimal {
  const n = row[field];
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error(`Invalid leverageBracket ${field} for ${symbol}`);
  }
  // String() of a JSON number yields its shortest decimal form, so no float error is introduced.
  return new Decimal(String(n));
}

/** Parse the leverage brackets for one symbol from a leverageBracket response. */
export function parseLeverageBrackets(body: unknown, symbol: string): LeverageBracket[] {
  if (!Array.isArray(body)) {
    throw new Error('Invalid leverageBracket response');
  }
  const item = body.find((b) => isRecord(b) && b.symbol === symbol);
  if (item === undefined) {
    throw new Error(`Symbol not found in leverageBracket: ${symbol}`);
  }
  if (!Array.isArray(item.brackets)) {
    throw new Error(`Invalid leverageBracket brackets for ${symbol}`);
  }
  const brackets: LeverageBracket[] = (item.brackets as unknown[]).map((raw) => {
    if (!isRecord(raw)) {
      throw new Error(`Invalid leverageBracket bracket for ${symbol}`);
    }
    const initialLeverage = raw.initialLeverage;
    if (
      typeof initialLeverage !== 'number' ||
      !Number.isInteger(initialLeverage) ||
      initialLeverage <= 0
    ) {
      throw new Error(`Invalid leverageBracket initialLeverage for ${symbol}`);
    }
    return {
      notionalFloor: bracketNumber(raw, 'notionalFloor', symbol),
      notionalCap: bracketNumber(raw, 'notionalCap', symbol),
      maintMarginRatio: bracketNumber(raw, 'maintMarginRatio', symbol),
      cum: bracketNumber(raw, 'cum', symbol),
      maxLeverage: initialLeverage,
    };
  });
  return brackets.sort((a, b) => a.notionalFloor.comparedTo(b.notionalFloor));
}
