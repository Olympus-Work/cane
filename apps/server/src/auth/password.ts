import { hash, verify } from '@node-rs/argon2';

/** argon2id with the library defaults (m=19 MiB, t=2, p=1). */
export const hashPassword = (password: string): Promise<string> => hash(password);

/** False for a wrong password and for a malformed hash; never throws. */
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}
