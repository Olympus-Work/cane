import {
  FUNDING_DAY_MS,
  WHITELIST_DEPTH_DAYS,
  fundingCandidates,
  fundingDepth,
  type CandidateList,
} from '@cane/core';
import type { FundingClient } from './funding.client.js';

/** The candidate list is read again after this long (plan F01b: new listings in, delisted out). */
export const CANDIDATES_REFRESH_MS = 60 * 60 * 1000;

/** One symbol to keep in `funding_rate`, with the start of the window it must cover. */
export interface FundingTarget {
  symbol: string;
  from: number;
  depthDays: number;
  /** Listing time when the symbol is younger than its depth (the window starts there). */
  listedAt: number | null;
}

export interface TargetOptions {
  /** Whitelist (until F15: `FUNDING_SYNC_SYMBOLS` or `--symbols`); 730 days each. */
  whitelist: readonly string[];
  /** Add every scanner candidate (30 days each). */
  candidates: boolean;
  depthDays?: { whitelist?: number; candidate?: number };
}

export interface TargetList {
  targets: FundingTarget[];
  /** TRADING USDT perpetuals left out for having no spot market under their symbol (empty when candidates are off). */
  noSpot: string[];
  /** Candidates whose symbol is outside the Binance ASCII format; not synced. */
  unsupported: string[];
}

/**
 * Which symbols the funding sync covers (plan F01b). Whitelist only = the F01
 * behaviour, no exchangeInfo request. With candidates, the perp and spot
 * listings are read at most once an hour; the filter lives in @cane/core.
 */
export class FundingCandidateSource {
  private cache: { at: number; list: CandidateList; onboard: Map<string, number> } | null = null;

  constructor(private readonly client: FundingClient) {}

  async targets(opts: TargetOptions, now: number): Promise<TargetList> {
    const whitelist = new Set(opts.whitelist);
    if (!opts.candidates) {
      const days = opts.depthDays?.whitelist ?? WHITELIST_DEPTH_DAYS;
      const targets = [...whitelist].map((symbol) => ({ symbol, from: now - days * FUNDING_DAY_MS, depthDays: days, listedAt: null }));
      return { targets, noSpot: [], unsupported: [] };
    }
    const { list, onboard } = await this.listings(now);
    const symbols = new Set([...whitelist, ...list.candidates.map((c) => c.symbol)]);
    const targets = [...symbols]
      .sort()
      .map((symbol) => ({ symbol, ...fundingDepth(symbol, whitelist, onboard.get(symbol) ?? null, now, opts.depthDays) }));
    return { targets, noSpot: list.noSpot, unsupported: list.unsupported };
  }

  private async listings(now: number): Promise<{ list: CandidateList; onboard: Map<string, number> }> {
    if (this.cache && now - this.cache.at < CANDIDATES_REFRESH_MS) return this.cache;
    const perps = await this.client.perpListings();
    const spot = await this.client.spotSymbols();
    const onboard = new Map(perps.map((p) => [p.symbol, p.onboardDate]));
    this.cache = { at: now, list: fundingCandidates(perps, spot), onboard };
    return this.cache;
  }
}
