import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { dataDir } from './db';

/**
 * Secret storage for InterviewHub (server-side only — never import from
 * client components).
 *
 * - The OpenRouter API key is stored AES-256-GCM-encrypted in the
 *   ai_settings.openrouter_key DB column (format `v1:<b64 iv>:<b64 ct+tag>`).
 * - The 32-byte encryption key comes from env INTERVIEWHUB_SECRET (>= 32
 *   chars, SHA-256-derived) or, failing that, a persistent key file at
 *   <DATA_DIR>/.secret-key (0600, generated once).
 * - On macOS the OpenRouter key itself can optionally live in the Keychain
 *   (service `InterviewHub`, account `openrouter`) instead of the DB; see
 *   app/api/ai-settings/route.ts (opt-in via INTERVIEWHUB_USE_KEYCHAIN=1).
 *
 * decryptSecret never throws and never includes secret material in errors.
 */

const KEY_FILE = '.secret-key';
const KEYCHAIN_SERVICE = 'InterviewHub';
const KEYCHAIN_ACCOUNT = 'openrouter';

function keyFilePath(): string {
  return path.join(dataDir(), KEY_FILE);
}

function getOrCreateFileKey(): Buffer {
  const file = keyFilePath();
  fs.mkdirSync(dataDir(), { recursive: true });
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    const buf = Buffer.from(raw, 'base64');
    if (buf.length === 32) return buf;
    // Corrupt/short file: fall through and regenerate.
  } catch {
    // Missing file: generate below.
  }
  const key = randomBytes(32);
  fs.writeFileSync(file, `${key.toString('base64')}\n`, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
  return key;
}

/** 32-byte encryption key. Throws only if INTERVIEWHUB_SECRET is set but too short. */
export function getEncryptionKey(): Buffer {
  const env = process.env.INTERVIEWHUB_SECRET;
  if (env !== undefined && env !== '') {
    if (env.length < 32) {
      throw new Error('INTERVIEWHUB_SECRET must be at least 32 characters');
    }
    return createHash('sha256').update(env, 'utf8').digest();
  }
  return getOrCreateFileKey();
}

/**
 * Session-signing secret (Node accessor). Derived from env-only key
 * material — SHA-256(`${INTERVIEWHUB_SECRET}:${APP_PASSWORD}`) — so the
 * Edge middleware (lib/session.ts) can reproduce the exact same bytes with
 * WebCrypto without filesystem access. Keep the input string in sync with
 * lib/session.ts `sessionSecretInput()`; the cross-compat test in
 * tests/api/auth.test.ts guards against drift.
 */
export function getSessionSecret(): Buffer {
  return createHash('sha256')
    .update(`${process.env.INTERVIEWHUB_SECRET ?? ''}:${process.env.APP_PASSWORD ?? ''}`, 'utf8')
    .digest();
}

/** AES-256-GCM encrypt. Output: `v1:<base64 iv>:<base64 ciphertext+authTag>`. */
export function encryptSecret(plain: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${Buffer.concat([ciphertext, tag]).toString('base64')}`;
}

/** Decrypt a value produced by encryptSecret. Returns null on any bad input — never throws. */
export function decryptSecret(stored: string | null | undefined): string | null {
  try {
    if (!stored || typeof stored !== 'string' || !stored.startsWith('v1:')) return null;
    const parts = stored.split(':');
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[1], 'base64');
    const ctAndTag = Buffer.from(parts[2], 'base64');
    if (iv.length !== 12 || ctAndTag.length <= 16) return null;
    const ciphertext = ctAndTag.subarray(0, ctAndTag.length - 16);
    const tag = ctAndTag.subarray(ctAndTag.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith('v1:');
}

// ---------------------------------------------------------------------------
// macOS Keychain (best-effort, server-side only). Every function is safe to
// call on Linux/other platforms: it returns false/null and never throws.
// ---------------------------------------------------------------------------

let keychainAvailableCache: boolean | null = null;

/** True only on macOS with the `security` CLI present. Never throws. */
export function keychainAvailable(): boolean {
  if (keychainAvailableCache !== null) return keychainAvailableCache;
  let ok = false;
  try {
    ok = process.platform === 'darwin';
    if (ok) execFileSync('which', ['security'], { stdio: 'ignore' });
  } catch {
    ok = false;
  }
  keychainAvailableCache = ok;
  return ok;
}

/** Read the OpenRouter key from the Keychain, or null when absent/unavailable. Never throws. */
export function keychainGet(): string | null {
  try {
    if (!keychainAvailable()) return null;
    const out = execFileSync(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
      { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' },
    );
    const v = (out as string).trim();
    return v || null;
  } catch {
    return null;
  }
}

/** Store/update the OpenRouter key in the Keychain. Returns false when unavailable. Never throws. */
export function keychainSet(secret: string): boolean {
  try {
    if (!keychainAvailable() || !secret) return false;
    execFileSync(
      'security',
      ['add-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w', secret, '-U'],
      { stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

/** Delete the OpenRouter key from the Keychain. Returns false when unavailable/absent. Never throws. */
export function keychainDelete(): boolean {
  try {
    if (!keychainAvailable()) return false;
    execFileSync(
      'security',
      ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT],
      { stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Which secret store is currently active for the encryption key / keychain
 * secret: env INTERVIEWHUB_SECRET, macOS Keychain, the persistent key file,
 * or none (no key material exists yet — one is generated on first encrypt).
 */
export function getSecretStorage(): 'env' | 'keychain' | 'file' | 'none' {
  const env = process.env.INTERVIEWHUB_SECRET;
  if (env !== undefined && env !== '') return 'env';
  if (keychainAvailable() && keychainGet()) return 'keychain';
  try {
    if (fs.existsSync(keyFilePath())) return 'file';
  } catch {
    /* ignore */
  }
  return 'none';
}
