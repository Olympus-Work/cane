import { Decimal } from 'decimal.js';
import type { Market } from '@cane/core';
import { ENDPOINTS, type BinanceEnv } from '../binance/endpoints.js';
import { BinanceError, BinanceRestClient, type BinanceCredentials, type HttpFn } from '../binance/rest.client.js';
import { BinanceTrading } from '../binance/trading.js';
import {
  ExchangeReadError,
  tickerKey,
  type ExchangeReader,
  type ExchangeSnapshot,
  type FuturesPositionInfo,
  type Ticker,
} from './exchange-reader.js';

/** The dashboard refreshes at most every 15 s (S09.5). */
const SNAPSHOT_TTL_MS = 15_000;
/** Binance `-1121`: invalid symbol (spot exchangeInfo with a symbol filter). */
const INVALID_SYMBOL = -1121;
/** Binance codes for a key that is invalid, wrong for this IP or lacks the permission (-2014, -2015, -1022, -2008). */
const KEY_REJECTED = new Set([-2014, -2015, -1022, -2008]);

type TickerRow = { symbol: string; lastPrice: string; priceChangePercent: string };
type PositionRow = {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  liquidationPrice: string;
};

/** `<name>: <message>` — never a URL, key or signature (B16.3). */
function shortMessage(err: unknown): string {
  const e = err instanceof Error ? err : new Error(String(err));
  return `${e.name}: ${e.message}`;
}

/**
 * Binance implementation of {@link ExchangeReader} (S09.5). Reads only: the
 * `BinanceTrading` it builds is always created with `tradingEnabled = false`,
 * so any accidental placement is refused before a request is made.
 */
export class BinanceExchangeReader implements ExchangeReader {
  private cached: { at: number; value: ExchangeSnapshot } | null = null;
  private inflight: Promise<ExchangeSnapshot> | null = null;

  constructor(
    private readonly credentials: () => Promise<BinanceCredentials | null>,
    private readonly http: HttpFn,
    private readonly env: BinanceEnv,
    private readonly now: () => number = Date.now,
  ) {}

  async snapshot(): Promise<ExchangeSnapshot> {
    if (this.cached && this.now() - this.cached.at < SNAPSHOT_TTL_MS) return this.cached.value;
    if (!this.inflight) {
      this.inflight = this.refresh().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  async isListed(market: Market, pair: string): Promise<boolean> {
    // Public endpoint: no key needed, so it works before a key is saved. The
    // credentials function throws if the client ever tried to sign.
    const rest = new BinanceRestClient(ENDPOINTS[this.env], () => {
      throw new Error('isListed must not need credentials');
    }, this.http);
    try {
      const body = (await rest.request(
        market,
        'GET',
        market === 'spot' ? '/api/v3/exchangeInfo' : '/fapi/v1/exchangeInfo',
        market === 'spot' ? { symbol: pair } : {},
        'none',
        'safe',
      )) as { symbols?: unknown };
      if (!Array.isArray(body.symbols)) throw new Error('Invalid exchangeInfo response');
      const entry = body.symbols.find(
        (s): s is { symbol: string; status: string; quoteAsset: string } =>
          s !== null && typeof s === 'object' && (s as { symbol?: unknown }).symbol === pair,
      );
      return entry !== undefined && entry.status === 'TRADING' && entry.quoteAsset === 'USDT';
    } catch (err) {
      if (err instanceof BinanceError && err.code === INVALID_SYMBOL) return false;
      if (err instanceof ExchangeReadError) throw err;
      throw new ExchangeReadError('unreachable', shortMessage(err));
    }
  }

  private async refresh(): Promise<ExchangeSnapshot> {
    try {
      const creds = await this.credentials();
      if (creds === null) throw new ExchangeReadError('no_key', 'No Binance key saved');
      const rest = new BinanceRestClient(ENDPOINTS[this.env], () => creds, this.http);
      const trading = new BinanceTrading(rest, false);
      const [spotEquity, futures, spotTickers, futuresTickers, positions] = await Promise.all([
        trading.spotEquityUsdt(),
        trading.futuresAccount(),
        rest.request('spot', 'GET', '/api/v3/ticker/24hr', {}, 'none', 'safe'),
        rest.request('futures', 'GET', '/fapi/v1/ticker/24hr', {}, 'none', 'safe'),
        rest.request('futures', 'GET', '/fapi/v3/positionRisk', {}, 'signed', 'safe'),
      ]);
      const spotRows = spotTickers as TickerRow[];
      const futuresRows = futuresTickers as TickerRow[];
      const positionRows = positions as PositionRow[];
      if (!Array.isArray(spotRows)) throw new Error('Invalid spot ticker response');
      if (!Array.isArray(futuresRows)) throw new Error('Invalid futures ticker response');
      if (!Array.isArray(positionRows)) throw new Error('Invalid positionRisk response');

      const tickers: Record<string, Ticker> = {};
      for (const row of spotRows) {
        if (row.symbol.endsWith('USDT')) {
          tickers[tickerKey('spot', row.symbol)] = { price: row.lastPrice, changePct: row.priceChangePercent };
        }
      }
      for (const row of futuresRows) {
        if (row.symbol.endsWith('USDT')) {
          tickers[tickerKey('futures', row.symbol)] = { price: row.lastPrice, changePct: row.priceChangePercent };
        }
      }

      const futuresPositions: FuturesPositionInfo[] = [];
      for (const row of positionRows) {
        if (new Decimal(row.positionAmt).isZero()) continue;
        futuresPositions.push({
          pair: row.symbol,
          amount: row.positionAmt,
          entryPrice: row.entryPrice,
          markPrice: row.markPrice,
          unrealizedPnl: row.unRealizedProfit,
          liquidationPrice: new Decimal(row.liquidationPrice).isZero() ? null : row.liquidationPrice,
        });
      }

      const value: ExchangeSnapshot = {
        spotEquity: spotEquity.toFixed(),
        futuresEquity: futures.equity.toFixed(),
        tickers,
        futuresPositions,
      };
      // Only a good refresh is cached; a failure keeps the last good value.
      this.cached = { at: this.now(), value };
      return value;
    } catch (err) {
      if (err instanceof ExchangeReadError) throw err;
      if (err instanceof BinanceError && KEY_REJECTED.has(err.code ?? 0)) throw new ExchangeReadError('key_rejected', shortMessage(err));
      throw new ExchangeReadError('unreachable', shortMessage(err));
    }
  }
}
