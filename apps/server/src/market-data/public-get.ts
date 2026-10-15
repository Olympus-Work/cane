import type { FetchFn } from './klines.client.js';

const MAX_ATTEMPTS = 5;

/**
 * GET a public Binance market-data URL (no key, no signature) and return its JSON body.
 * Retries 429 / 418 / 5xx with Retry-After or exponential back-off; any other
 * non-2xx status throws at once. `label` names the request in error messages.
 */
export async function publicGetJson(
  fetchFn: FetchFn,
  sleep: (ms: number) => Promise<void>,
  url: string,
  label: string,
): Promise<unknown> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetchFn(url, { method: 'GET' });
    if (res.ok) return res.json();
    if (res.status !== 429 && res.status !== 418 && res.status < 500) {
      throw new Error(`${label} request failed with status ${res.status}`);
    }
    if (attempt === MAX_ATTEMPTS) {
      throw new Error(`${label} request failed after ${MAX_ATTEMPTS} attempts with status ${res.status}`);
    }
    const retryAfter = res.headers.get('Retry-After');
    const delayMs =
      retryAfter !== null && retryAfter !== '' && !Number.isNaN(Number(retryAfter))
        ? Number(retryAfter) * 1000
        : 1000 * 2 ** (attempt - 1);
    await sleep(delayMs);
  }
  // Unreachable: the loop always returns or throws.
  throw new Error(`${label} request failed`);
}
