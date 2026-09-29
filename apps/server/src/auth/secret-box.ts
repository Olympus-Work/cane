import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_LEN = 12;
const TAG_LEN = 16;

/** Parses `CANE_MASTER_KEY`: 32 bytes as base64 or 64 hex characters. */
export function parseMasterKey(raw: string | undefined): Buffer {
  if (!raw) throw new Error('CANE_MASTER_KEY is not set');
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('CANE_MASTER_KEY must be 32 bytes (base64 or 64 hex characters)');
  return key;
}

/** AES-256-GCM for secrets stored in the database. Layout: `iv | tag | ciphertext`. */
export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('SecretBox needs a 32-byte key');
  }

  encrypt(plain: string): Buffer {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  }

  /** Throws if the blob was changed or was written with another key. */
  decrypt(blob: Buffer): string {
    if (blob.length < IV_LEN + TAG_LEN) throw new Error('encrypted value is too short');
    const decipher = createDecipheriv('aes-256-gcm', this.key, blob.subarray(0, IV_LEN));
    decipher.setAuthTag(blob.subarray(IV_LEN, IV_LEN + TAG_LEN));
    return Buffer.concat([decipher.update(blob.subarray(IV_LEN + TAG_LEN)), decipher.final()]).toString('utf8');
  }
}

/** What the UI may show of a secret (B15.1): the last 4 characters. */
export const hintOf = (secret: string): string => (secret.length <= 4 ? '****' : secret.slice(-4));
