import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanupTempDir, jsonBody, makeTempDataDir } from '../helpers';

const dir = makeTempDataDir();
process.env.APP_PASSWORD = 'test-password-123';
process.env.TRUST_PROXY = '1';
afterAll(() => {
  delete process.env.APP_PASSWORD;
  delete process.env.TRUST_PROXY;
  cleanupTempDir(dir);
});

const auth = await import('@/lib/auth');
const session = await import('@/lib/session');
const { POST: login } = await import('@/app/api/auth/login/route');
const { POST: logout } = await import('@/app/api/auth/logout/route');

const ALLOW_ALL = () => ({ allowed: true, retryAfterSeconds: 0 });
const DENY_ALL = () => ({ allowed: false, retryAfterSeconds: 30 });

function loginReq(password: string, ip: string): Request {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ password }),
  });
}

function setCookies(res: Response): string[] {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === 'function') return h.getSetCookie();
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

beforeEach(() => auth.resetLoginRateLimits());

describe('auth: password + sessions', () => {
  it('verifyPassword accepts the configured password and rejects anything else', () => {
    expect(auth.verifyPassword('test-password-123')).toBe(true);
    expect(auth.verifyPassword('wrong')).toBe(false);
    expect(auth.verifyPassword('')).toBe(false);
    expect(auth.verifyPassword(null)).toBe(false);
    const prev = process.env.APP_PASSWORD;
    try {
      delete process.env.APP_PASSWORD;
      expect(auth.isAuthEnabled()).toBe(false);
      expect(auth.verifyPassword('test-password-123')).toBe(false);
    } finally {
      process.env.APP_PASSWORD = prev!;
    }
  });

  it('createSession/verifySession round-trip; tampered, expired, and garbage fail', () => {
    const token = auth.createSession();
    expect(auth.verifySession(token)).toBe(true);
    expect(token.split('.').length).toBe(4);
    // Tamper with the MAC.
    const tampered = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
    expect(auth.verifySession(tampered)).toBe(false);
    expect(auth.verifySession(auth.createSession(Date.now() - 1000))).toBe(false);
    expect(auth.verifySession('garbage')).toBe(false);
    expect(auth.verifySession(null)).toBe(false);
    expect(auth.verifySession(undefined)).toBe(false);
  });

  it('Node (lib/auth) and Edge (lib/session) session tokens verify under each other', async () => {
    const nodeToken = auth.createSession();
    expect(await session.verifySessionToken(nodeToken)).toBe(true);
    const edgeToken = await session.createSessionToken();
    expect(auth.verifySession(edgeToken)).toBe(true);
    expect(await session.verifySessionToken(edgeToken)).toBe(true);
  });

  it('CSRF double-submit tokens match only themselves', () => {
    const t = auth.createCsrfToken();
    expect(auth.verifyCsrfToken(t, t)).toBe(true);
    expect(auth.verifyCsrfToken(t, auth.createCsrfToken())).toBe(false);
    expect(auth.verifyCsrfToken(null, t)).toBe(false);
    expect(auth.verifyCsrfToken(t, null)).toBe(false);
    expect(auth.verifyCsrfToken('', '')).toBe(false);
  });

  it('isLocalHost recognises localhost forms and rejects remote hosts', () => {
    expect(auth.isLocalHost('localhost:3000')).toBe(true);
    expect(auth.isLocalHost('localhost')).toBe(true);
    expect(auth.isLocalHost('127.0.0.1:3000')).toBe(true);
    expect(auth.isLocalHost('[::1]:3000')).toBe(true);
    expect(auth.isLocalHost('::1')).toBe(true);
    expect(auth.isLocalHost('example.com')).toBe(false);
    expect(auth.isLocalHost('192.168.1.5:3000')).toBe(false);
    expect(auth.isLocalHost(null)).toBe(false);
  });

  it('resolveClientIp uses X-Forwarded-For only when TRUST_PROXY=1', () => {
    const xff = new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' });
    expect(auth.resolveClientIp(xff, true, '10.0.0.2')).toBe('203.0.113.9');
    expect(auth.resolveClientIp(xff, false, '10.0.0.2')).toBe('10.0.0.2');
    expect(auth.resolveClientIp(new Headers(), true, null)).toBe('127.0.0.1');
  });
});

describe('auth: login/logout routes', () => {
  it('wrong password -> 401 with no session cookie', async () => {
    const res = await login(loginReq('nope', '10.0.0.11'));
    expect(res.status).toBe(401);
    expect(((await jsonBody(res)).error as string)).toBe('Invalid password');
    expect(setCookies(res).join(';')).not.toContain('ih_session=');
  });

  it('correct password -> 200 and sets ih_session + ih_csrf cookies', async () => {
    const res = await login(loginReq('test-password-123', '10.0.0.12'));
    expect(res.status).toBe(200);
    const cookies = setCookies(res).join(';');
    expect(cookies).toContain('ih_session=');
    expect(cookies).toContain('ih_csrf=');
    expect(cookies).toMatch(/HttpOnly/i);
    // The CSRF cookie must be JS-readable (no HttpOnly on ih_csrf).
    const csrf = setCookies(res).find((c) => c.startsWith('ih_csrf='));
    expect(csrf).toBeTruthy();
    expect(csrf).not.toMatch(/HttpOnly/i);
  });

  it('5 wrong attempts per IP, then 429 on the 6th', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login(loginReq('wrong', '10.0.0.13'))).status).toBe(401);
    }
    const blocked = await login(loginReq('wrong', '10.0.0.13'));
    expect(blocked.status).toBe(429);
    expect(((await jsonBody(blocked)).error as string)).toMatch(/Too many login attempts/);
    // Another IP is unaffected.
    expect((await login(loginReq('wrong', '10.0.0.14'))).status).toBe(401);
  });

  it('logout clears both cookies', async () => {
    const res = await logout();
    expect(res.status).toBe(200);
    const cookies = setCookies(res);
    expect(cookies.some((c) => c.startsWith('ih_session=') && /Max-Age=0/i.test(c))).toBe(true);
    expect(cookies.some((c) => c.startsWith('ih_csrf=') && /Max-Age=0/i.test(c))).toBe(true);
  });
});

describe('auth: access decisions (middleware logic, via evaluateAccess)', () => {
  const validSession = () => auth.createSession();

  it('protected API without a session -> 401 when APP_PASSWORD is set', async () => {
    const d = await auth.evaluateAccess({ pathname: '/api/candidates', host: 'localhost:3000', rateLimit: ALLOW_ALL });
    expect(d.decision).toBe('unauthorized');
    if (d.decision === 'unauthorized') expect(d.status).toBe(401);
  });

  it('protected page without a session -> redirect to /login', async () => {
    const d = await auth.evaluateAccess({ pathname: '/candidates', host: 'localhost:3000', rateLimit: ALLOW_ALL });
    expect(d.decision).toBe('redirect-login');
    if (d.decision === 'redirect-login') expect(d.redirectTo).toBe('/login?next=%2Fcandidates');
  });

  it('public paths pass without a session', async () => {
    for (const p of ['/login', '/api/health', '/api/auth/login']) {
      const d = await auth.evaluateAccess({ pathname: p, method: p === '/api/auth/login' ? 'POST' : 'GET', host: 'localhost:3000', rateLimit: ALLOW_ALL });
      expect(d.decision).toBe('allow');
    }
  });

  it('valid session allows reads; mutating API calls need matching CSRF', async () => {
    const token = validSession();
    const read = await auth.evaluateAccess({ pathname: '/api/candidates', host: 'localhost:3000', sessionToken: token, rateLimit: ALLOW_ALL });
    expect(read.decision).toBe('allow');
    const noCsrf = await auth.evaluateAccess({ pathname: '/api/candidates', method: 'POST', host: 'localhost:3000', sessionToken: token, rateLimit: ALLOW_ALL });
    expect(noCsrf.decision).toBe('csrf-invalid');
    const csrf = auth.createCsrfToken();
    const withCsrf = await auth.evaluateAccess({
      pathname: '/api/candidates', method: 'POST', host: 'localhost:3000',
      sessionToken: token, csrfHeader: csrf, csrfCookie: csrf, rateLimit: ALLOW_ALL,
    });
    expect(withCsrf.decision).toBe('allow');
    // Login + health are CSRF-exempt even when mutating.
    const loginPost = await auth.evaluateAccess({ pathname: '/api/auth/login', method: 'POST', host: 'localhost:3000', sessionToken: token, rateLimit: ALLOW_ALL });
    expect(loginPost.decision).toBe('allow');
  });

  it('rate-limited API calls -> 429', async () => {
    const d = await auth.evaluateAccess({ pathname: '/api/candidates', host: 'localhost:3000', rateLimit: DENY_ALL });
    expect(d.decision).toBe('rate-limited');
    if (d.decision === 'rate-limited') expect(d.status).toBe(429);
  });

  it('remote host -> 403 when no password is set; localhost still passes', async () => {
    const prev = process.env.APP_PASSWORD;
    try {
      delete process.env.APP_PASSWORD;
      const remote = await auth.evaluateAccess({ pathname: '/api/candidates', host: 'example.com', rateLimit: ALLOW_ALL });
      expect(remote.decision).toBe('forbidden-remote');
      if (remote.decision === 'forbidden-remote') expect(remote.status).toBe(403);
      const remotePage = await auth.evaluateAccess({ pathname: '/candidates', host: '203.0.113.5:3000', rateLimit: ALLOW_ALL });
      expect(remotePage.decision).toBe('forbidden-remote');
      const local = await auth.evaluateAccess({ pathname: '/api/candidates', host: 'localhost:3000', rateLimit: ALLOW_ALL });
      expect(local.decision).toBe('allow');
    } finally {
      process.env.APP_PASSWORD = prev!;
    }
  });
});
