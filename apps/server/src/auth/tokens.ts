import { createHash, randomBytes } from 'node:crypto';

export const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

/** 256-bit session token for the cookie; only `sha256Hex(token)` is stored. */
export const newSessionToken = (): string => randomBytes(32).toString('base64url');

export const RECOVERY_CODE_COUNT = 10;

/** 10 codes like `k3f9-x2mq-7h4d`: 60 random bits each, shown once, stored as SHA-256. */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const s = randomBytes(8).toString('hex').slice(0, 12);
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
  });
}

/** Recovery codes are compared case-insensitively and without dashes. */
export const normaliseRecoveryCode = (code: string): string => code.trim().toLowerCase().replace(/-/g, '');
