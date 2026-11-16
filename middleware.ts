import { NextRequest, NextResponse } from 'next/server';
import { rateLimitIp } from './lib/security';
import { CSRF_COOKIE, SESSION_COOKIE, evaluateAccess, resolveClientIp } from './lib/session';

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // Static assets / Next internals never hit the auth gate.
  if (pathname.startsWith('/_next/') || pathname === '/favicon.ico') {
    return NextResponse.next();
  }

  const trustProxy = process.env.TRUST_PROXY === '1';
  const ip = resolveClientIp(req.headers, trustProxy, (req as unknown as { ip?: string }).ip ?? null);

  const decision = await evaluateAccess({
    pathname,
    method: req.method,
    host: req.headers.get('host'),
    ip,
    sessionToken: req.cookies.get(SESSION_COOKIE)?.value ?? null,
    csrfHeader: req.headers.get('x-ih-csrf'),
    csrfCookie: req.cookies.get(CSRF_COOKIE)?.value ?? null,
    rateLimit: rateLimitIp,
  });

  switch (decision.decision) {
    case 'allow':
      return NextResponse.next();
    case 'rate-limited':
      return NextResponse.json(
        { error: 'Too many requests', retry_after_seconds: decision.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } },
      );
    case 'unauthorized':
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    case 'forbidden-remote':
      return new NextResponse('Remote access requires APP_PASSWORD', { status: 403 });
    case 'csrf-invalid':
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    case 'redirect-login': {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.search = `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(url);
    }
  }
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
