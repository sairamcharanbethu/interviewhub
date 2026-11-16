/**
 * Edge-safe session / CSRF / access-decision helpers.
 *
 * This module must stay free of Node-only imports (no fs, child_process,
 * node:crypto): middleware.ts runs on the Edge runtime. All cryptography
 * here uses WebCrypto (globalThis.crypto), which is available in both the
 * Edge runtime and Node 18+.
 *
 * Session token format (shared with the Node implementation in lib/auth.ts):
 *   `v1.<base64url random 32 bytes>.<expiry epoch ms>.<hex HMAC-SHA256>`
 * where the HMAC is over `${random}.${expiry}` with the session secret
 * SHA-256(`${INTERVIEWHUB_SECRET}:${APP_PASSWORD}`) — the same env-only
 * derivation as lib/secrets.ts getSessionSecret(). A cross-compat test in
 * tests/api/auth.test.ts verifies tokens created by either implementation
 * verify under the other.
 */

export const SESSION_COOKIE = 'ih_session';
export const CSRF_COOKIE = 'ih_csrf';
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

export function isAuthEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

/** The exact input string whose SHA-256 is the session secret. Must match lib/secrets.ts. */
export function sessionSecretInput(): string {
  return `${process.env.INTERVIEWHUB_SECRET ?? ''}:${process.env.APP_PASSWORD ?? ''}`;
}

async function deriveSessionSecret(): Promise<Uint8Array> {
  const data = new TextEncoder().encode(sessionSecretInput());
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret: Uint8Array, message: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toHex(new Uint8Array(sig));
}

/** Constant-time string comparison (Edge-safe). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(expiresAtMs: number = Date.now() + SESSION_MAX_AGE_SECONDS * 1000): Promise<string> {
  const rand = new Uint8Array(32);
  globalThis.crypto.getRandomValues(rand);
  const randomPart = base64url(rand);
  const expiryPart = String(expiresAtMs);
  const secret = await deriveSessionSecret();
  const mac = await hmacHex(secret, `${randomPart}.${expiryPart}`);
  return `v1.${randomPart}.${expiryPart}.${mac}`;
}

/** Verify a session token. Returns false (never throws) for malformed/expired/forged tokens. */
export async function verifySessionToken(token: string | null | undefined): Promise<boolean> {
  try {
    if (!token || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') return false;
    const [, randomPart, expiryPart, mac] = parts;
    const expiry = Number(expiryPart);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) return false;
    base64urlToBytes(randomPart); // throws on malformed base64url
    const secret = await deriveSessionSecret();
    const expected = await hmacHex(secret, `${randomPart}.${expiryPart}`);
    return timingSafeEqualStr(expected, mac.toLowerCase());
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// CSRF: double-submit cookie. Random token in a non-httpOnly cookie
// (`ih_csrf`) plus a matching `x-ih-csrf` request header.
// ---------------------------------------------------------------------------

export function createCsrfToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export function verifyCsrfToken(header: string | null | undefined, cookie: string | null | undefined): boolean {
  if (!header || !cookie || typeof header !== 'string' || typeof cookie !== 'string') return false;
  return timingSafeEqualStr(header, cookie);
}

// ---------------------------------------------------------------------------
// Host / IP helpers (pure, Edge-safe).
// ---------------------------------------------------------------------------

/** True for localhost hostnames (host header may include a port). */
export function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return false;
  let h = host.trim().toLowerCase();
  if (h === '::1') return true; // bare IPv6 loopback (bracketed form handled below)
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    h = end >= 0 ? h.slice(1, end) : h;
  } else {
    const colon = h.lastIndexOf(':');
    if (colon >= 0 && /^\d+$/.test(h.slice(colon + 1))) h = h.slice(0, colon);
  }
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');
}

/**
 * Resolve the client IP. Uses the first X-Forwarded-For entry only when
 * TRUST_PROXY=1 (proxy in front); otherwise the socket remote address.
 * `remoteIp` is the socket address supplied by the caller (NextRequest.ip);
 * when unavailable it falls back to 127.0.0.1.
 */
export function resolveClientIp(
  headers: Headers,
  trustProxy: boolean,
  remoteIp?: string | null,
): string {
  if (trustProxy) {
    const xff = headers.get('x-forwarded-for');
    if (xff) {
      const first = xff.split(',')[0]?.trim();
      if (first) return first;
    }
  }
  return remoteIp || '127.0.0.1';
}

// ---------------------------------------------------------------------------
// Pure access decision (shared by middleware.ts and tests).
// ---------------------------------------------------------------------------

export type AccessDecision =
  | { decision: 'allow' }
  | { decision: 'rate-limited'; status: 429; retryAfterSeconds: number }
  | { decision: 'unauthorized'; status: 401 }
  | { decision: 'redirect-login'; status: 302; redirectTo: string }
  | { decision: 'forbidden-remote'; status: 403 }
  | { decision: 'csrf-invalid'; status: 403 };

const PUBLIC_PATHS = new Set(['/login', '/api/health', '/api/auth/login']);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

/**
 * Decide access for one request. `rateLimit` is injected by the caller
 * (lib/security.ts rateLimitIp in middleware; a stub in tests) so this stays
 * pure apart from the async session check.
 */
export async function evaluateAccess(opts: {
  pathname: string;
  method?: string;
  host?: string | null;
  ip?: string;
  sessionToken?: string | null;
  csrfHeader?: string | null;
  csrfCookie?: string | null;
  rateLimit?: (ip: string) => { allowed: boolean; retryAfterSeconds: number };
}): Promise<AccessDecision> {
  const { pathname, method = 'GET', host = null, ip = '127.0.0.1' } = opts;
  const isApi = pathname.startsWith('/api/');

  // (a) Bounded per-IP rate limit on API routes (existing 429 behaviour).
  if (isApi && opts.rateLimit) {
    const r = opts.rateLimit(ip);
    if (!r.allowed) return { decision: 'rate-limited', status: 429, retryAfterSeconds: r.retryAfterSeconds };
  }

  if (!isAuthEnabled()) {
    // (b) No password set: local use only.
    if (!isLocalHost(host)) return { decision: 'forbidden-remote', status: 403 };
    return { decision: 'allow' };
  }

  // Auth enabled.
  if (isPublicPath(pathname)) return { decision: 'allow' };
  const authed = opts.sessionToken ? await verifySessionToken(opts.sessionToken) : false;
  if (!authed) {
    if (isApi) return { decision: 'unauthorized', status: 401 };
    return { decision: 'redirect-login', status: 302, redirectTo: `/login?next=${encodeURIComponent(pathname)}` };
  }

  // (c) CSRF on mutating API calls (login/health are exempt).
  if (isApi && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method.toUpperCase())) {
    if (pathname !== '/api/auth/login' && pathname !== '/api/health') {
      if (!verifyCsrfToken(opts.csrfHeader, opts.csrfCookie)) {
        return { decision: 'csrf-invalid', status: 403 };
      }
    }
  }
  return { decision: 'allow' };
}
