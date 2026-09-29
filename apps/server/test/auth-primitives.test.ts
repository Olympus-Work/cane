import 'reflect-metadata';
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { generateSecret, generateSync } from 'otplib';
import { SecretBox, hintOf, parseMasterKey } from '../src/auth/secret-box.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { checkTotp, newTotpSecret, totpUri } from '../src/auth/totp.js';
import { newRecoveryCodes, newSessionToken, normaliseRecoveryCode, sha256Hex } from '../src/auth/tokens.js';

const KEY = Buffer.alloc(32, 5); // obviously fake 32-byte key

describe('SecretBox / parseMasterKey', () => {
  it('encrypt then decrypt returns the original string', () => {
    const box = new SecretBox(KEY);
    const plain = 'ทดสอบ-key-123';
    expect(box.decrypt(box.encrypt(plain))).toBe(plain);
  });

  it('two encryptions of the same plaintext give different blobs that both decrypt', () => {
    const box = new SecretBox(KEY);
    const a = box.encrypt('same-plaintext');
    const b = box.encrypt('same-plaintext');
    expect(a.equals(b)).toBe(false);
    expect(box.decrypt(a)).toBe('same-plaintext');
    expect(box.decrypt(b)).toBe('same-plaintext');
  });

  it('blob length is 12 (iv) + 16 (tag) + ciphertext bytes', () => {
    const box = new SecretBox(KEY);
    const plain = 'ทดสอบ-key-123';
    expect(box.encrypt(plain).length).toBe(12 + 16 + Buffer.byteLength(plain));
  });

  it('throws when the ciphertext, the tag, or the key is wrong', () => {
    const box = new SecretBox(KEY);
    const blob = box.encrypt('secret-value');

    const tamperedCipher = Buffer.from(blob);
    tamperedCipher[12 + 16 + 1] = ~tamperedCipher.readUInt8(12 + 16 + 1) & 0xff;
    expect(() => box.decrypt(tamperedCipher)).toThrow();

    const tamperedTag = Buffer.from(blob);
    tamperedTag[12] = ~tamperedTag.readUInt8(12) & 0xff;
    expect(() => box.decrypt(tamperedTag)).toThrow();

    const otherBox = new SecretBox(Buffer.alloc(32, 9));
    expect(() => otherBox.decrypt(blob)).toThrow();
  });

  it('decrypt of a blob shorter than 28 bytes throws', () => {
    const box = new SecretBox(KEY);
    expect(() => box.decrypt(Buffer.alloc(27))).toThrow();
  });

  it('a key that is not 32 bytes throws', () => {
    expect(() => new SecretBox(Buffer.alloc(31))).toThrow();
  });

  it('parseMasterKey accepts 64 hex chars and 32-byte base64, rejects the rest', () => {
    const hex = 'ab'.repeat(32);
    expect(parseMasterKey(hex)).toEqual(Buffer.from(hex, 'hex'));
    expect(parseMasterKey(hex).length).toBe(32);

    const b64 = Buffer.alloc(32, 7).toString('base64');
    expect(parseMasterKey(b64)).toEqual(Buffer.alloc(32, 7));

    expect(() => parseMasterKey(undefined)).toThrow();
    expect(() => parseMasterKey('')).toThrow();
    expect(() => parseMasterKey(Buffer.alloc(16).toString('base64'))).toThrow();
    expect(() => parseMasterKey('z'.repeat(64))).toThrow();
  });

  it('hintOf shows the last 4 characters, or **** for short secrets', () => {
    expect(hintOf('abcdefgh')).toBe('efgh');
    expect(hintOf('abc')).toBe('****');
    expect(hintOf('abcd')).toBe('****');
  });
});

describe('password', () => {
  it('hashes with argon2id and verifies correctly', async () => {
    const hash = await hashPassword('fake-password-123');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'fake-password-123')).toBe(true);
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
    expect(await hashPassword('fake-password-123')).not.toBe(hash);
  });
});

describe('totp', () => {
  const T = 1_700_000_010_000; // ms
  const EPOCH = T / 1000;
  const STEP = Math.floor(EPOCH / 30);
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'; // fake base32 secret (20 bytes)

  const codeAt = (epochSeconds: number): string =>
    generateSync({ strategy: 'totp', secret, epoch: epochSeconds });

  it('verifies a code generated at T and returns its step', () => {
    expect(checkTotp(secret, codeAt(EPOCH), null, T)).toBe(STEP);
  });

  it('verifies adjacent steps and rejects a 90-second-old code', () => {
    expect(checkTotp(secret, codeAt(EPOCH - 30), null, T)).toBe(STEP - 1);
    expect(checkTotp(secret, codeAt(EPOCH + 30), null, T)).toBe(STEP + 1);
    expect(checkTotp(secret, codeAt(EPOCH - 90), null, T)).toBeNull();
  });

  it('rejects a replayed code and accepts the next step after it', () => {
    const lastStep = STEP; // the step returned for the code at T
    expect(checkTotp(secret, codeAt(EPOCH), lastStep, T)).toBeNull();
    expect(checkTotp(secret, codeAt(EPOCH + 30), lastStep, T + 30_000)).toBe(STEP + 1);
  });

  it('returns null for malformed codes', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', ' 123456']) {
      expect(checkTotp(secret, bad, null, T)).toBeNull();
    }
  });

  it('returns null for a wrong 6-digit code', () => {
    const valid = [codeAt(EPOCH - 30), codeAt(EPOCH), codeAt(EPOCH + 30)];
    const digits = '0123456789';
    let wrong: string | null = null;
    for (const d of digits) {
      const candidate = '123456'.slice(0, 5) + d;
      if (!valid.includes(candidate)) {
        wrong = candidate;
        break;
      }
    }
    // The three adjacent codes cannot cover all 10 possible last digits.
    expect(wrong).not.toBeNull();
    expect(checkTotp(secret, wrong as string, null, T)).toBeNull();
  });

  it('builds an otpauth URI with issuer Cane', () => {
    const uri = totpUri(secret, 'owner@example.com');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('issuer=Cane');
    expect(uri).toContain(`secret=${secret}`);
  });

  it('newTotpSecret returns a base32 string of at least 16 characters', () => {
    const a = newTotpSecret();
    const b = newTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]+$/);
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(a).not.toBe(b);
  });
});

describe('tokens', () => {
  it('sha256Hex matches the known digest of "abc"', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('newSessionToken returns a 43-character base64url string', () => {
    const a = newSessionToken();
    const b = newSessionToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('newRecoveryCodes returns 10 distinct codes', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    for (const code of codes) {
      expect(code).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
    }
    expect(new Set(codes).size).toBe(10);
  });

  it('normaliseRecoveryCode trims, lowercases and strips dashes', () => {
    expect(normaliseRecoveryCode('  AB12-cd34-EF56 ')).toBe('ab12cd34ef56');
  });
});
