import { Injectable } from '@nestjs/common';
import { TIMEFRAMES, type Candle, type Market, type Timeframe } from '@cane/core';
import { KlineCache } from '../market-data/kline-cache.js';
import type { ReplayResult } from './replay.types.js';
import { simulate } from './simulate.js';

export interface ReplayRequest {
  pair: string;
  market: Market;
  from: number;
  to: number;
}

/**
 * Loads public closed candles (full history, for warm-up) and replays the
 * core rules. Depends on public market data only: no keys, no order client.
 */
@Injectable()
export class ReplayService {
  constructor(private readonly klines: KlineCache) {}

  async run(req: ReplayRequest, nowMs: number = Date.now()): Promise<ReplayResult> {
    const candles = {} as Record<Timeframe, Candle[]>;
    for (const tf of TIMEFRAMES) {
      candles[tf] = await this.klines.closedCandles(req.market, req.pair, tf, nowMs);
    }
    return simulate({ ...req, candles });
  }
}
