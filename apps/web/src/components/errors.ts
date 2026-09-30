import { ApiError, NetworkError } from '../api.js';

/** Maps an API/network failure to a user-facing message (translated by the caller's `t`). */
export function errorText(err: unknown, t: (key: string) => string): string {
  if (err instanceof NetworkError) return t('networkError');
  if (err instanceof ApiError) {
    if (err.status === 401) return t('sessionExpired');
    if (err.status >= 500) return t('serverError');
    return err.serverMessage ? err.serverMessage : t('serverError');
  }
  return t('serverError');
}
