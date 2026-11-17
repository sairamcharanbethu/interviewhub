// Safe subprocess runner for CLI AI providers (Codex, Antigravity).
// Argument arrays only — never shell strings. Isolated temp working dir
// per call, strict timeout, 2 MB output cap, one call at a time per
// provider is enforced by the caller's semaphore (see lib/ai/adapters.ts).
// No secrets are ever passed via env to CLI processes.
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface CliRunOptions {
  timeoutMs: number;
  /** Max stdout+stderr bytes kept (default 2 MB). */
  maxOutputBytes?: number;
  cwd?: string;
}
export interface CliRunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}
export type CliRunner = (
  cmd: string,
  args: string[],
  opts: CliRunOptions,
) => Promise<CliRunResult>;

export const MAX_CLI_OUTPUT_BYTES = 2 * 1024 * 1024;

function defaultRunner(cmd: string, args: string[], opts: CliRunOptions): Promise<CliRunResult> {
  const cwd = opts.cwd || fs.mkdtempSync(path.join(os.tmpdir(), 'ih-cli-'));
  const maxBytes = opts.maxOutputBytes ?? MAX_CLI_OUTPUT_BYTES;
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = execFile(cmd, args, { cwd, timeout: opts.timeoutMs, maxBuffer: maxBytes, windowsHide: true }, (err, out, errOut) => {
      if (settled) return;
      settled = true;
      stdout = String(out ?? '').slice(0, maxBytes);
      stderr = String(errOut ?? '').slice(0, maxBytes);
      if (err) {
        const code = (err as NodeJS.ErrnoException & { code?: number | string }).code;
        if (typeof code === 'number') return resolve({ stdout, stderr, code });
        // Timeout / spawn failure: surface as a rejected error with a kind.
        const e = new Error(`CLI call failed: ${err.message}`) as Error & { kind?: string };
        if (/ETIMEDOUT|timeout/i.test(err.message)) e.kind = 'timeout';
        else if (/ENOENT/i.test(err.message)) e.kind = 'unavailable';
        return reject(e);
      }
      resolve({ stdout, stderr, code: 0 });
    });
    void child;
  });
}

let runner: CliRunner = defaultRunner;
/** Test hook: replace the subprocess runner with a mock. Never used in prod. */
export function __setCliRunner(r: CliRunner | null): void {
  runner = r ?? defaultRunner;
}
export function runCli(cmd: string, args: string[], opts: CliRunOptions): Promise<CliRunResult> {
  return runner(cmd, args, opts);
}

/** Resolve an executable via `which` + allowlisted locations. Returns null when not found. */
export async function whichCli(name: string, extraPaths: string[] = []): Promise<string | null> {
  try {
    const r = await runCli('which', [name], { timeoutMs: 5000 });
    const p = r.stdout.trim().split('\n')[0]?.trim();
    if (p) return p;
  } catch { /* fall through to allowlisted paths */ }
  for (const p of extraPaths) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch { /* ignore */ }
  }
  return null;
}

export function makeCliTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ih-cli-'));
}
