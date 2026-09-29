/** `testnet` = Binance Demo Trading (plan rev 3.2); `live` only in the production deploy. */
export type BinanceEnv = 'testnet' | 'live';

export type BinanceMarket = 'spot' | 'futures';

export interface BinanceEndpoints {
  /** REST base per market. */
  rest: Record<BinanceMarket, string>;
  /** Spot WebSocket API (user data via `userDataStream.subscribe.signature`). */
  spotWsApi: string;
  /** USDⓈ-M stream base; the user data stream is `${futuresStream}/ws/<listenKey>`. */
  futuresStream: string;
}

export const ENDPOINTS: Record<BinanceEnv, BinanceEndpoints> = {
  testnet: {
    rest: { spot: 'https://demo-api.binance.com', futures: 'https://demo-fapi.binance.com' },
    spotWsApi: 'wss://demo-ws-api.binance.com/ws-api/v3',
    futuresStream: 'wss://demo-fstream.binance.com',
  },
  live: {
    rest: { spot: 'https://api.binance.com', futures: 'https://fapi.binance.com' },
    spotWsApi: 'wss://ws-api.binance.com:443/ws-api/v3',
    futuresStream: 'wss://fstream.binance.com',
  },
};

/** Reads `BINANCE_ENV`; anything but exactly `live` is testnet (safe default). */
export function binanceEnvFrom(value: string | undefined): BinanceEnv {
  return value === 'live' ? 'live' : 'testnet';
}
