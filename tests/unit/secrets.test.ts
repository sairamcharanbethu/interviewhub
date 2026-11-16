import fs from 'fs';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTempDir, makeTempDataDir } from '../helpers';

const dir = makeTempDataDir();
afterAll(() => {
  delete process.env.INTERVIEWHUB_SECRET;
  cleanupTempDir(dir);
});

const secrets = await import('@/lib/secrets');
const { encryptSecret, decryptSecret, isEncrypted, getSecretStorage, keychainAvailable, keychainGet, keychainSet, keychainDelete } = secrets;
const { maskKey } = await import('@/lib/security');
const { getAiSettings } = await import('@/lib/ai/providers');
const dbLib = await import('@/lib/db');

const PLAINTEXT = 'sk-or-test-abcdefghij1234567890';

describe('secrets: AES-256-GCM encrypt/decrypt', () => {
  it('round-trips a key and uses the v1:<iv>:<ct+tag> format', () => {
    const stored = encryptSecret(PLAINTEXT);
    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored.split(':').length).toBe(3);
    expect(stored).not.toContain(PLAINTEXT);
    expect(decryptSecret(stored)).toBe(PLAINTEXT);
    expect(isEncrypted(stored)).toBe(true);
    expect(isEncrypted(PLAINTEXT)).toBe(false);
    expect(isEncrypted(null)).toBe(false);
  });

  it('generates a persistent 0600 key file under DATA_DIR', () => {
    encryptSecret('x');
    const file = path.join(dir, '.secret-key');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64').length).toBe(32);
    // Second encrypt reuses the same key (decrypt still works).
    expect(decryptSecret(encryptSecret(PLAINTEXT))).toBe(PLAINTEXT);
  });

  it('detects tampering: flipped ciphertext, truncated, and garbage all return null', () => {
    const stored = encryptSecret(PLAINTEXT);
    const parts = stored.split(':');
    const ct = parts[2];
    const flipped = ct.slice(0, 4) + (ct[4] === 'A' ? 'B' : 'A') + ct.slice(5);
    expect(decryptSecret(`v1:${parts[1]}:${flipped}`)).toBeNull();
    expect(decryptSecret(`v1:${parts[1]}:${ct.slice(0, 8)}`)).toBeNull();
    expect(decryptSecret('garbage')).toBeNull();
    expect(decryptSecret('v1:only-two')).toBeNull();
    expect(decryptSecret('')).toBeNull();
    expect(decryptSecret(null)).toBeNull();
    expect(decryptSecret(undefined)).toBeNull();
    // decryptSecret never throws, even on hostile input.
    expect(() => decryptSecret('v1:!!!:???')).not.toThrow();
  });

  it('uses INTERVIEWHUB_SECRET (>= 32 chars) when set, and rejects short ones', () => {
    const prev = process.env.INTERVIEWHUB_SECRET;
    try {
      process.env.INTERVIEWHUB_SECRET = 'a'.repeat(40);
      expect(getSecretStorage()).toBe('env');
      expect(decryptSecret(encryptSecret(PLAINTEXT))).toBe(PLAINTEXT);
      process.env.INTERVIEWHUB_SECRET = 'too-short';
      expect(() => encryptSecret(PLAINTEXT)).toThrow(/at least 32/);
    } finally {
      if (prev === undefined) delete process.env.INTERVIEWHUB_SECRET;
      else process.env.INTERVIEWHUB_SECRET = prev;
    }
  });

  it('reports the file store once a key file exists', () => {
    delete process.env.INTERVIEWHUB_SECRET;
    encryptSecret('x');
    expect(getSecretStorage()).toBe('file');
  });

  it('keychain functions never throw and report unavailable on Linux', () => {
    expect(keychainAvailable()).toBe(false);
    expect(keychainGet()).toBeNull();
    expect(keychainSet('sk-or-x')).toBe(false);
    expect(keychainDelete()).toBe(false);
  });

  it('masked output never contains the key', () => {
    const masked = maskKey(PLAINTEXT);
    expect(masked).toEqual({ has_key: true, last4: '7890' });
    // The full key (minus its last 4, which ARE the mask output) must not appear.
    expect(JSON.stringify(masked)).not.toContain(PLAINTEXT.slice(0, -4));
    expect(JSON.stringify(maskKey(null))).not.toContain('sk-or');
  });

  it('migrates a legacy plaintext key via getAiSettings()', () => {
    dbLib.run(`UPDATE ai_settings SET openrouter_key = ? WHERE id = 1`, PLAINTEXT);
    expect(getAiSettings().openrouter_key).toBe(PLAINTEXT);
    const row = dbLib.get<{ openrouter_key: string }>(`SELECT openrouter_key FROM ai_settings WHERE id = 1`);
    expect(row!.openrouter_key.startsWith('v1:')).toBe(true);
    expect(decryptSecret(row!.openrouter_key)).toBe(PLAINTEXT);
    // Clean up so later tests see no key.
    dbLib.run(`UPDATE ai_settings SET openrouter_key = NULL WHERE id = 1`);
  });
});
