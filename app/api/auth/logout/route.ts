export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { CSRF_COOKIE, SESSION_COOKIE } from '@/lib/auth';

/** POST -> clears the session + CSRF cookies. Always succeeds. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  res.cookies.set(CSRF_COOKIE, '', { httpOnly: false, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
