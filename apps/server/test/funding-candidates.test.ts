import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { FUNDING_DAY_MS, WHITELIST_DEPTH_DAYS, CANDIDATE_DEPTH_DAYS, type PerpListing } from '@cane/core';
import type { FundingClient } from '../src/funding/funding.client.js';
import { CANDIDATES_REFRESH_MS, FundingCandidateSource } from '../src/funding/funding.candidates.js';
import { DEFAULT_SYMBOLS, whitelistOf } from '../src/funding/funding.commands.js';

const NOW = Date.UTC(2026, 9, 22);

const listing = (symbol: string, over: Partial<PerpListing> = {}): PerpListing => ({
  symbol,
  contractType: 'PERPETUAL',
  status: 'TRADING',
  quoteAsset: 'USDT',
  onboardDate: NOW - 400 * FUNDING_DAY_MS,
  ...over,
});

/** FundingClient stand-in: the two exchangeInfo calls, counted. */
function fakeClient(perps: PerpListing[], spot: readonly string[]) {
  const perpListings = vi.fn(async () => perps);
  const spotSymbols = vi.fn(async () => new Set(spot));
  return { perpListings, spotSymbols, client: { perpListings, spotSymbols } as unknown as FundingClient };
}

describe('FundingCandidateSource.targets', () => {
  it('candidates off: whitelist only, no exchangeInfo request', async () => {
    const { client, perpListings } = fakeClient([], []);
    const source = new FundingCandidateSource(client);

    const { targets, noSpot } = await source.targets({ whitelist: ['BTCUSDT', 'ETHUSDT'], candidates: false }, NOW);

    expect(perpListings).not.toHaveBeenCalled();
    expect(noSpot).toEqual([]);
    expect(targets).toEqual(
      ['BTCUSDT', 'ETHUSDT'].map((symbol) => ({
        symbol,
        from: NOW - WHITELIST_DEPTH_DAYS * FUNDING_DAY_MS,
        depthDays: WHITELIST_DEPTH_DAYS,
        listedAt: null,
      })),
    );
  });

  it('candidates on: whitelist plus candidates, sorted, each with its own window', async () => {
    const perps = [
      listing('BTCUSDT', { onboardDate: NOW - 1000 * FUNDING_DAY_MS }), // whitelisted, listed long ago
      listing('NEWUSDT', { onboardDate: NOW - 10 * FUNDING_DAY_MS }), // candidate listed 10 days ago
      listing('OLDUSDT'), // candidate older than its 30-day window
      listing('1000PEPEUSDT'), // no spot market under the same symbol -> noSpot
      listing('XAUUSDT', { contractType: 'TRADIFI_PERPETUAL' }), // not a plain PERPETUAL -> dropped
      listing('BTCUSDC', { quoteAsset: 'USDC' }), // not USDT-quoted -> dropped
      listing('OMGUSDT', { status: 'SETTLING' }), // not TRADING -> dropped
    ];
    const { client, perpListings } = fakeClient(perps, ['BTCUSDT', 'NEWUSDT', 'OLDUSDT', 'PEPEUSDT']);
    const source = new FundingCandidateSource(client);

    const { targets, noSpot } = await source.targets({ whitelist: ['BTCUSDT'], candidates: true }, NOW);

    expect(perpListings).toHaveBeenCalledTimes(1);
    expect(targets.map((t) => t.symbol)).toEqual(['BTCUSDT', 'NEWUSDT', 'OLDUSDT']);
    const bySymbol = new Map(targets.map((t) => [t.symbol, t]));
    expect(bySymbol.get('BTCUSDT')).toEqual({
      symbol: 'BTCUSDT',
      from: NOW - WHITELIST_DEPTH_DAYS * FUNDING_DAY_MS,
      depthDays: WHITELIST_DEPTH_DAYS,
      listedAt: null,
    });
    expect(bySymbol.get('NEWUSDT')).toEqual({
      symbol: 'NEWUSDT',
      from: NOW - 10 * FUNDING_DAY_MS,
      depthDays: CANDIDATE_DEPTH_DAYS,
      listedAt: NOW - 10 * FUNDING_DAY_MS,
    });
    expect(bySymbol.get('OLDUSDT')).toEqual({
      symbol: 'OLDUSDT',
      from: NOW - CANDIDATE_DEPTH_DAYS * FUNDING_DAY_MS,
      depthDays: CANDIDATE_DEPTH_DAYS,
      listedAt: null,
    });
    expect(noSpot).toEqual(['1000PEPEUSDT']);
  });

  it('caches the listings for CANDIDATES_REFRESH_MS', async () => {
    const { client, perpListings } = fakeClient([listing('OLDUSDT')], ['OLDUSDT']);
    const source = new FundingCandidateSource(client);
    const opts = { whitelist: [], candidates: true };

    await source.targets(opts, NOW);
    await source.targets(opts, NOW + CANDIDATES_REFRESH_MS - 60_000); // 59 minutes later
    expect(perpListings).toHaveBeenCalledTimes(1);

    await source.targets(opts, NOW + CANDIDATES_REFRESH_MS); // 60 minutes later
    expect(perpListings).toHaveBeenCalledTimes(2);
  });
});

describe('whitelistOf', () => {
  it('the --symbols option wins over the environment', () => {
    expect(whitelistOf({ symbols: ['XMRUSDT'] }, 'BTCUSDT,ETHUSDT')).toEqual(['XMRUSDT']);
  });

  it('else FUNDING_SYNC_SYMBOLS', () => {
    expect(whitelistOf({}, 'XMRUSDT, PEPEUSDT')).toEqual(['XMRUSDT', 'PEPEUSDT']);
  });

  it('else the defaults', () => {
    expect(whitelistOf({}, undefined)).toEqual(DEFAULT_SYMBOLS);
    expect(whitelistOf({}, '')).toEqual(DEFAULT_SYMBOLS);
  });
});
