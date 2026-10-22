/** One day in ms; funding-depth windows are counted in whole days (funding-arb plan F01b). */
export const FUNDING_DAY_MS = 24 * 60 * 60 * 1000;

/** History a whitelisted symbol must cover (spec B1: at least 2 years). */
export const WHITELIST_DEPTH_DAYS = 730;

/** History a scanner candidate must cover to be ranked (spec B29 uses 30-day averages, plan F01b). */
export const CANDIDATE_DEPTH_DAYS = 30;

/** One USDⓈ-M symbol from /fapi/v1/exchangeInfo, only the fields the filter reads. */
export interface PerpListing {
  symbol: string;
  contractType: string; // 'PERPETUAL', 'CURRENT_QUARTER', 'TRADIFI_PERPETUAL', ...
  status: string; // 'TRADING', 'SETTLING', ...
  quoteAsset: string;
  onboardDate: number; // UTC ms
}

/** A perp that passed the filter and has a TRADING spot market under the same symbol. */
export interface FundingCandidate {
  symbol: string;
  onboardDate: number;
}

export interface CandidateList {
  candidates: FundingCandidate[]; // sorted by symbol
  /** TRADING USDT perpetuals with no TRADING spot market under the same symbol (e.g. multiplier contracts like 1000PEPEUSDT). Sorted. */
  noSpot: string[];
}

/**
 * Funding-arb universe (funding-arb plan F01b, spec B28): USDT perpetuals in
 * TRADING that also have a TRADING spot market (`spotSymbols` already holds
 * only TRADING spot symbols). Everything else is dropped silently; duplicate
 * symbols keep the first.
 */
export function fundingCandidates(perps: readonly PerpListing[], spotSymbols: ReadonlySet<string>): CandidateList {
  const seen = new Set<string>();
  const candidates: FundingCandidate[] = [];
  const noSpot: string[] = [];
  for (const p of perps) {
    if (p.contractType !== 'PERPETUAL' || p.status !== 'TRADING' || p.quoteAsset !== 'USDT') continue;
    if (seen.has(p.symbol)) continue;
    seen.add(p.symbol);
    if (spotSymbols.has(p.symbol)) {
      candidates.push({ symbol: p.symbol, onboardDate: p.onboardDate });
    } else {
      noSpot.push(p.symbol);
    }
  }
  candidates.sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  noSpot.sort();
  return { candidates, noSpot };
}

/** How far back funding history must reach for one symbol (funding-arb plan F01b). */
export interface FundingDepth {
  /** Start of the window this symbol must cover. */
  from: number;
  depthDays: number;
  /** Set when the symbol was listed after now − depth: the window starts at its listing. */
  listedAt: number | null;
}

/**
 * The funding window for a symbol (funding-arb plan F01b, spec B28): whitelisted
 * symbols look back WHITELIST_DEPTH_DAYS, candidates CANDIDATE_DEPTH_DAYS; a
 * symbol listed inside the window only has to cover its own lifetime.
 */
export function fundingDepth(
  symbol: string,
  whitelist: ReadonlySet<string>,
  onboardDate: number | null,
  now: number,
  depthDays?: { whitelist?: number; candidate?: number },
): FundingDepth {
  const days = whitelist.has(symbol)
    ? depthDays?.whitelist ?? WHITELIST_DEPTH_DAYS
    : depthDays?.candidate ?? CANDIDATE_DEPTH_DAYS;
  const windowFrom = now - days * FUNDING_DAY_MS;
  if (onboardDate !== null && onboardDate > windowFrom) {
    return { from: onboardDate, depthDays: days, listedAt: onboardDate };
  }
  return { from: windowFrom, depthDays: days, listedAt: null };
}
