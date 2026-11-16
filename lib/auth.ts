import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getSessionSecret } from './secrets';

// Re-export the Edge-safe session/CSRF/host helpers (single source of truth
// lives in lib/session.ts; this module adds the Node-only pieces).
export {
  SESSION_COOKIE,
  CSRF_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  isAuthEnabled,
  isLocalHost,
  resolveClientIp,
  isPublicPath,
  createCsrfToken,
  verifyCsrfToken,
  timingSafeEqualStr,
  evaluateAccess,
  createSessionToken,
  verifySessionToken,
  type AccessDecision,
} from './session';

/**
 * Optional password auth (server-side only).
 *
 * Enabled when APP_PASSWORD is set. Sessions are HMAC-SHA256-signed tokens
 * (see lib/session.ts for the shared format); the signing secret comes from
 * lib/secrets key material (getSessionSecret()).
 */

// ---------------------------------------------------------------------------
// Password check (SHA-256 + timing-safe compare; never leaks which part failed).
// ---------------------------------------------------------------------------

export function verifyPassword(candidate: string | null | undefined): boolean {
  const configured = process.env.APP_PASSWORD;
  if (!configured || !candidate) return false;
  const a = createHash('sha256').update(candidate, 'utf8').digest();
  const b = createHash('sha256').update(configured, 'utf8').digest();
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Sessions (Node implementation; must stay format-compatible with
// lib/session.ts createSessionToken/verifySessionToken — cross-compat test in
// tests/api/auth.test.ts).
// ---------------------------------------------------------------------------

/** Create a signed session token expiring in 7 days (or at `expiresAtMs`). */
export function createSession(expiresAtMs: number = Date.now() + 7 * 24 * 60 * 60 * 1000): string {
  const randomPart = randomBytes(32).toString('base64url');
  const expiryPart = String(expiresAtMs);
  const mac = createHmac('sha256', getSessionSecret())
    .update(`${randomPart}.${expiryPart}`, 'utf8')
    .digest('hex');
  return `v1.${randomPart}.${expiryPart}.${mac}`;
}

/** Verify a session token. Returns false (never throws) for malformed/expired/forged tokens. */
export function verifySession(token: string | null | undefined): boolean {
  try {
    if (!token || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') return false;
    const [, randomPart, expiryPart, mac] = parts;
    const expiry = Number(expiryPart);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) return false;
    Buffer.from(randomPart, 'base64url'); // throws on malformed input
    const expected = createHmac('sha256', getSessionSecret())
      .update(`${randomPart}.${expiryPart}`, 'utf8')
      .digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(mac.toLowerCase(), 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Cookie options for the session cookie. `secure` is the caller's call: true unless the request is localhost. */
export function sessionCookieOptions(secure: boolean): {
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 7 * 24 * 60 * 60 };
}

/** Cookie options for the (non-httpOnly, JS-readable) double-submit CSRF cookie. */
export function csrfCookieOptions(secure: boolean): {
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return { httpOnly: false, sameSite: 'lax', secure, path: '/', maxAge: 7 * 24 * 60 * 60 };
}

// ---------------------------------------------------------------------------
// Login rate limit: bounded LRU — max 500 IPs, 15-minute window,
// 5 attempts per IP, then 429. Expired entries are swept on insert.
// ---------------------------------------------------------------------------

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_MAX_IPS = 500;

const loginHits = new Map<string, { count: number; resetAt: number }>();

/**
 * Record one login attempt for `ip` and report whether it is allowed.
 * Call on every login POST (before checking the password); the 6th attempt
 * inside a 15-minute window is rejected.
 */
export function loginRateLimit(ip: string): { allowed: boolean; retryAfterSeconds: number } {
  const nowMs = Date.now();
  const entry = loginHits.get(ip);
  if (!entry || nowMs > entry.resetAt) {
    // Sweep expired entries on insert, then evict oldest-first if still over the cap.
    for (const [k, v] of loginHits) {
      if (nowMs > v.resetAt) loginHits.delete(k);
    }
    while (loginHits.size >= LOGIN_MAX_IPS) {
      const oldest = loginHits.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      loginHits.delete(oldest);
    }
    loginHits.set(ip, { count: 1, resetAt: nowMs + LOGIN_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  entry.count += 1;
  if (entry.count > LOGIN_MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - nowMs) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function loginRateLimitSize(): number {
  return loginHits.size;
}

/** Test/support helper: clear all login rate-limit state. */
export function resetLoginRateLimits(): void {
  loginHits.clear();
}
