export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { handleError, ApiError } from '@/lib/errors';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  createCsrfToken,
  createSession,
  csrfCookieOptions,
  isAuthEnabled,
  isLocalHost,
  loginRateLimit,
  resolveClientIp,
  sessionCookieOptions,
  verifyPassword,
} from '@/lib/auth';

/**
 * POST { password } -> sets ih_session + ih_csrf cookies.
 * Wrong password -> 401 with no detail beyond "Invalid password" (no user
 * enumeration: there is only one password, and no account list exists).
 * 5 failed attempts per IP in 15 minutes -> 429.
 * When APP_PASSWORD is not set, password auth is disabled and this endpoint
 * answers 400.
 */
export async function POST(req: Request) {
  try {
    if (!isAuthEnabled()) throw new ApiError(400, 'Password auth is not enabled');
    const ip = resolveClientIp(req.headers, process.env.TRUST_PROXY === '1');
    const rl = loginRateLimit(ip);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts', retry_after_seconds: rl.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
      );
    }
    let body: unknown = null;
    try {
      body = await req.json();
    } catch {
      throw new ApiError(400, 'Invalid JSON body');
    }
    const password = (body as Record<string, unknown>)?.password;
    if (typeof password !== 'string' || !verifyPassword(password)) {
      throw new ApiError(401, 'Invalid password');
    }
    // Secure only when the request is not localhost (local dev over http).
    const secure = !isLocalHost(req.headers.get('host'));
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, createSession(), sessionCookieOptions(secure));
    res.cookies.set(CSRF_COOKIE, createCsrfToken(), csrfCookieOptions(secure));
    return res;
  } catch (e) {
    return handleError(e);
  }
}
