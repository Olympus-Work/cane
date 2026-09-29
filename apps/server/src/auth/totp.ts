import { generateSecret, generateURI, verifySync } from 'otplib';

export const TOTP_ISSUER = 'Cane';
const TOLERANCE_SECONDS = 30; // +-1 step

export const newTotpSecret = (): string => generateSecret();

export const totpUri = (secret: string, email: string): string => generateURI({ issuer: TOTP_ISSUER, label: email, secret });

const PERIOD_SECONDS = 30;

/**
 * Checks a 6-digit code (+-1 step) and returns its time step, or null.
 * A code at or below `lastStep` is a replay and is rejected (RFC 6238 §5.2);
 * the caller stores the returned step. `nowMs` is injectable for tests.
 */
export function checkTotp(secret: string, code: string, lastStep: number | null, nowMs: number = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const epoch = Math.floor(nowMs / 1000);
  const r = verifySync({
    strategy: 'totp',
    secret,
    token: code,
    epoch,
    epochTolerance: TOLERANCE_SECONDS,
    ...(lastStep === null ? {} : { afterTimeStep: lastStep }),
  });
  return r.valid ? Math.floor(epoch / PERIOD_SECONDS) + r.delta : null;
}
