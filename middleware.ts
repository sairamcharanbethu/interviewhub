import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from './lib/security';

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/api/')) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
    const r = rateLimit(ip);
    if (!r.allowed) {
      return NextResponse.json({ error: 'Too many requests', retry_after_seconds: r.retryAfterSeconds }, { status: 429, headers: { 'Retry-After': String(r.retryAfterSeconds) } });
    }
  }
  return NextResponse.next();
}
export const config = { matcher: ['/api/:path*'] };
