import { describe, expect, it } from 'vitest';
import {
  CANDIDATE_DEPTH_DAYS,
  FUNDING_DAY_MS,
  WHITELIST_DEPTH_DAYS,
  fundingCandidates,
  fundingDepth,
  type PerpListing,
} from '../src/funding/candidates.js';

const T0 = Date.UTC(2024, 0, 1);

function perp(symbol: string, over: Partial<PerpListing> = {}): PerpListing {
  return { symbol, contractType: 'PERPETUAL', status: 'TRADING', quoteAsset: 'USDT', onboardDate: T0, ...over };
}

describe('fundingCandidates (plan F01b, spec B28)', () => {
  it('keeps a TRADING USDT perpetual that has a spot market', () => {
    const list = fundingCandidates([perp('BTCUSDT')], new Set(['BTCUSDT']));
    expect(list.candidates).toEqual([{ symbol: 'BTCUSDT', onboardDate: T0 }]);
    expect(list.noSpot).toEqual([]);
  });

  it.each([
    ['CURRENT_QUARTER', { contractType: 'CURRENT_QUARTER' }],
    ['TRADIFI_PERPETUAL', { contractType: 'TRADIFI_PERPETUAL' }],
    ['status SETTLING', { status: 'SETTLING' }],
    ['quote USDC', { quoteAsset: 'USDC' }],
  ])('drops a %s perp', (_label, over) => {
    const list = fundingCandidates([perp('BTCUSDT', over)], new Set(['BTCUSDT']));
    expect(list.candidates).toEqual([]);
    expect(list.noSpot).toEqual([]);
  });

  it('puts a perp with no spot market under the same symbol into noSpot', () => {
    // multiplier contract: spot lists PEPEUSDT, never 1000PEPEUSDT
    const list = fundingCandidates([perp('1000PEPEUSDT')], new Set(['PEPEUSDT']));
    expect(list.candidates).toEqual([]);
    expect(list.noSpot).toEqual(['1000PEPEUSDT']);
  });

  it('puts a perp whose spot is not TRADING into noSpot', () => {
    // the spot set only holds TRADING spot symbols, so an absent symbol means no usable spot
    const list = fundingCandidates([perp('XYZUSDT')], new Set());
    expect(list.candidates).toEqual([]);
    expect(list.noSpot).toEqual(['XYZUSDT']);
  });

  it('sorts both outputs by symbol', () => {
    const list = fundingCandidates(
      [perp('ETHUSDT'), perp('BTCUSDT'), perp('2000SCRTUSDT'), perp('1000PEPEUSDT')],
      new Set(['BTCUSDT', 'ETHUSDT']),
    );
    expect(list.candidates.map((c) => c.symbol)).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(list.noSpot).toEqual(['1000PEPEUSDT', '2000SCRTUSDT']);
  });

  it('keeps the first of duplicate symbols', () => {
    const list = fundingCandidates(
      [perp('BTCUSDT', { onboardDate: T0 }), perp('BTCUSDT', { onboardDate: T0 + 1 }), perp('BTCUSDT')],
      new Set(['BTCUSDT']),
    );
    expect(list.candidates).toEqual([{ symbol: 'BTCUSDT', onboardDate: T0 }]);
  });
});

describe('fundingDepth (plan F01b, spec B28)', () => {
  const NOW = Date.UTC(2026, 9, 22);

  it('whitelisted symbols look back 730 days', () => {
    const d = fundingDepth('BTCUSDT', new Set(['BTCUSDT']), T0, NOW);
    expect(d.depthDays).toBe(WHITELIST_DEPTH_DAYS);
    expect(d.from).toBe(NOW - 730 * FUNDING_DAY_MS);
    expect(d.listedAt).toBeNull();
  });

  it('other symbols look back 30 days', () => {
    const d = fundingDepth('NEWUSDT', new Set(['BTCUSDT']), T0, NOW);
    expect(d.depthDays).toBe(CANDIDATE_DEPTH_DAYS);
    expect(d.from).toBe(NOW - 30 * FUNDING_DAY_MS);
    expect(d.listedAt).toBeNull();
  });

  it('clamps the window to the listing when the symbol is new', () => {
    const listed = NOW - 10 * FUNDING_DAY_MS;
    const d = fundingDepth('NEWUSDT', new Set(), listed, NOW);
    expect(d.from).toBe(listed);
    expect(d.listedAt).toBe(listed);
  });

  it('does not clamp without an onboard date', () => {
    const d = fundingDepth('NEWUSDT', new Set(), null, NOW);
    expect(d.from).toBe(NOW - 30 * FUNDING_DAY_MS);
    expect(d.listedAt).toBeNull();
  });

  it('accepts custom depths', () => {
    expect(fundingDepth('BTCUSDT', new Set(['BTCUSDT']), null, NOW, { whitelist: 5 }).from).toBe(NOW - 5 * FUNDING_DAY_MS);
    expect(fundingDepth('NEWUSDT', new Set(), null, NOW, { candidate: 60 }).from).toBe(NOW - 60 * FUNDING_DAY_MS);
  });
});
