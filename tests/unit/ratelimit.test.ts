import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rateLimit, rateLimitIp, rateLimitStoreSize, resetRateLimits } from '@/lib/security';

beforeEach(() => resetRateLimits());
afterEach(() => vi.useRealTimers());

describe('bounded rate limiter (rateLimitIp)', () => {
  it('allows 100 requests per minute per IP, then 429s the 101st', () => {
    for (let i = 0; i < 100; i++) expect(rateLimitIp('10.1.1.1').allowed).toBe(true);
    const denied = rateLimitIp('10.1.1.1');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    // A different IP is unaffected.
    expect(rateLimitIp('10.1.1.2').allowed).toBe(true);
  });

  it('resets after the 60s window', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 100; i++) rateLimitIp('10.2.2.2');
    expect(rateLimitIp('10.2.2.2').allowed).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(rateLimitIp('10.2.2.2').allowed).toBe(true);
  });

  it('stays bounded: 2000 distinct IPs never grow the map past 1000', () => {
    for (let i = 0; i < 2000; i++) rateLimitIp(`192.168.0.${i % 256}.${Math.floor(i / 256)}`);
    expect(rateLimitStoreSize()).toBeLessThanOrEqual(1000);
    expect(rateLimitStoreSize()).toBeGreaterThan(0);
  });

  it('legacy rateLimit() delegates to the bounded implementation', () => {
    for (let i = 0; i < 100; i++) expect(rateLimit('10.3.3.3').allowed).toBe(true);
    expect(rateLimit('10.3.3.3').allowed).toBe(false);
    expect(rateLimitStoreSize()).toBe(1);
  });
});
