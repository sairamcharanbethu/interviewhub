import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Test helper: point the app at a throwaway DATA_DIR / SKILLS_DIR.
 * Must be called BEFORE the first db() call in a test file (db() is lazy,
 * so calling this at module top-level — after imports — is safe).
 * Never points at ./data.
 */
export function makeTempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-test-'));
  process.env.DATA_DIR = dir;
  process.env.SKILLS_DIR = path.join(dir, 'skills');
  // No AI provider in tests: offline fallbacks must kick in.
  delete process.env.OPENROUTER_API_KEY;
  return dir;
}

export function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Build a Request the same way Next route handlers receive one. */
export function jsonReq(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function jsonBody(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { _raw: text }; }
}
