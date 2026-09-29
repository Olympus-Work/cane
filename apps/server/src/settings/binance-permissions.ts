import { BinanceError, BinanceRestClient, type BinanceCredentials, type HttpFn } from '../binance/rest.client.js';
import { ENDPOINTS, binanceEnvFrom } from '../binance/endpoints.js';
import type { Market } from '@cane/core';

/** What `GET /sapi/v1/account/apiRestrictions` says about a key (B15.2). */
export interface KeyPermissions {
  withdrawals: boolean;
  universalTransfer: boolean;
  spotTrading: boolean;
  futuresTrading: boolean;
}

export const PERMISSION_CHECKER = Symbol('PERMISSION_CHECKER');

/** Port so tests can mock it: the endpoint returns 404 on Demo Trading (plan, S08). */
export interface BinancePermissionChecker {
  check(credentials: BinanceCredentials): Promise<KeyPermissions>;
}

export type KeyVerdict = { ok: true } | { ok: false; message: string };

/**
 * B15.2: reject a key that can withdraw or transfer, and one that cannot trade
 * in every market in use (or, with none in use yet, in at least one).
 */
export function judgeKey(p: KeyPermissions, marketsInUse: readonly Market[]): KeyVerdict {
  if (p.withdrawals) return { ok: false, message: 'Withdrawals are enabled on this key. Turn off "Enable Withdrawals" on Binance and try again.' };
  if (p.universalTransfer) return { ok: false, message: 'Universal transfer is enabled on this key. Turn it off on Binance and try again.' };
  const can = (m: Market): boolean => (m === 'spot' ? p.spotTrading : p.futuresTrading);
  if (marketsInUse.length === 0) {
    if (!p.spotTrading && !p.futuresTrading) return { ok: false, message: 'This key cannot trade. Enable Spot & Margin Trading and/or Futures on Binance.' };
  } else {
    const missing = marketsInUse.filter((m) => !can(m));
    if (missing.length > 0) return { ok: false, message: `This key cannot trade ${missing.join(' and ')}, which a strategy uses. Enable it on Binance.` };
  }
  return { ok: true };
}

/** Production checker: one signed GET on the spot host of the configured environment. */
export class BinanceApiPermissionChecker implements BinancePermissionChecker {
  constructor(private readonly http: HttpFn) {}

  async check(credentials: BinanceCredentials): Promise<KeyPermissions> {
    const client = new BinanceRestClient(ENDPOINTS[binanceEnvFrom(process.env.BINANCE_ENV)], () => credentials, this.http);
    try {
      const r = (await client.request('spot', 'GET', '/sapi/v1/account/apiRestrictions', {}, 'signed', 'safe')) as Record<string, unknown>;
      return {
        withdrawals: r.enableWithdrawals === true,
        universalTransfer: r.permitsUniversalTransfer === true,
        spotTrading: r.enableSpotAndMarginTrading === true,
        futuresTrading: r.enableFutures === true,
      };
    } catch (e) {
      if (e instanceof BinanceError) throw new KeyCheckError('Binance did not accept this key (invalid key or secret, or the permission check is unavailable).');
      throw new KeyCheckError('Could not reach Binance to check this key. Nothing was saved.');
    }
  }
}

/** A message that is safe to show the owner: it never contains the key or secret. */
export class KeyCheckError extends Error {}
