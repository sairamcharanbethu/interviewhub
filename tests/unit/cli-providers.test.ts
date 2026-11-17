import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { cleanupTempDir, makeTempDataDir } from '../helpers';
import { __setCliRunner } from '@/lib/ai/cli';
import { codexProvider, antigravityProvider, ProviderError } from '@/lib/ai/adapters';
import { completeJsonWithFallback, completeTextWithFallback } from '@/lib/ai/registry';
import { get, run } from '@/lib/db';

const dir = makeTempDataDir();
afterAll(() => { __setCliRunner(null); cleanupTempDir(dir); });

// No OpenRouter key; Ollama pointed at a dead port so it fails fast.
beforeEach(() => {
  run(`UPDATE ai_settings SET openrouter_key = NULL, ollama_base_url = 'http://127.0.0.1:9' WHERE id = 1`);
});

const schema = z.object({ greeting: z.string() });

function cliOk(stdout: string, code = 0) {
  return { stdout, stderr: '', code };
}

describe('codex CLI adapter (mocked child_process)', () => {
  it('completeJson writes schema to a temp file and parses the answer file', async () => {
    __setCliRunner(async (cmd, args) => {
      if (cmd === 'which') return cliOk('/usr/local/bin/codex\n');
      if (args[0] === 'login') return cliOk('Signed in\n');
      // codex exec: write the answer file like the real CLI does.
      const fs = await import('fs');
      const oIdx = args.indexOf('-o');
      if (oIdx >= 0) fs.writeFileSync(args[oIdx + 1], JSON.stringify({ greeting: 'hello' }));
      return cliOk('{"greeting":"hello"}');
    });
    const av = await codexProvider.isAvailable();
    expect(av.available).toBe(true);
    expect(av.authStatus).toBe('authenticated');
    const r = await codexProvider.completeJson('Say hello', schema);
    expect(r.data).toEqual({ greeting: 'hello' });
    expect(r.provider).toBe('codex');
  });

  it('isAvailable reports not_authenticated when login status fails', async () => {
    __setCliRunner(async (cmd, args) => {
      if (cmd === 'which') return cliOk('/usr/local/bin/codex\n');
      return cliOk('', 1);
    });
    const av = await codexProvider.isAvailable();
    expect(av.available).toBe(false);
    expect(av.authStatus).toBe('not_authenticated');
    expect(av.installed).toBe(true);
  });

  it('completeJson rejects when codex is not installed', async () => {
    __setCliRunner(async (cmd) => {
      if (cmd === 'which') return cliOk('');
      return cliOk('', 1);
    });
    await expect(codexProvider.completeJson('hi', schema)).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('antigravity CLI adapter (mocked child_process)', () => {
  it('completeJson parses the SUCCESS envelope structured_output', async () => {
    __setCliRunner(async (cmd, args) => {
      if (cmd === 'which') return cliOk('/home/user/.local/bin/agy\n');
      if (args[0] === 'models') return cliOk(JSON.stringify([{ name: 'gemini-2.5-pro' }]));
      return cliOk(JSON.stringify({ status: 'SUCCESS', structured_output: { greeting: 'hello' } }));
    });
    const av = await antigravityProvider.isAvailable();
    expect(av.available).toBe(true);
    const r = await antigravityProvider.completeJson('Say hello', schema);
    expect(r.data).toEqual({ greeting: 'hello' });
    expect(r.provider).toBe('antigravity');
  });

  it('auth failure surfaces as auth_expired', async () => {
    __setCliRunner(async (cmd, args) => {
      if (cmd === 'which') return cliOk('/home/user/.local/bin/agy\n');
      if (args[0] === 'models') return cliOk('', 1);
      throw new Error('authentication required: please sign in');
    });
    const av = await antigravityProvider.isAvailable();
    expect(av.authStatus).toBe('not_verified');
    await expect(antigravityProvider.completeJson('hi', schema)).rejects.toMatchObject({ kind: 'auth_expired' });
  });
});

describe('registry fallback chain', () => {
  it('falls through a timing-out codex to antigravity', async () => {
    __setCliRunner(async (cmd, args) => {
      if (cmd === 'which' && args[0] === 'codex') return cliOk('/usr/local/bin/codex\n');
      if (cmd === 'which' && args[0] === 'agy') return cliOk('/home/user/.local/bin/agy\n');
      if (cmd.includes('codex')) {
        if (args[0] === 'login') return cliOk('Signed in\n');
        const e = new Error('CLI call failed: timeout of 120000ms exceeded') as Error & { kind?: string };
        e.kind = 'timeout';
        throw e;
      }
      if (args[0] === 'models') return cliOk(JSON.stringify([{ name: 'gemini-2.5-pro' }]));
      return cliOk(JSON.stringify({ status: 'SUCCESS', structured_output: { greeting: 'from agy' } }));
    });
    run(`UPDATE ai_settings SET provider_priority = ? WHERE id = 1`, JSON.stringify(['codex', 'antigravity', 'openrouter', 'ollama', 'fallback']));
    const out = await completeJsonWithFallback('Say hello', schema);
    expect(out.origin).toBe('ai');
    expect(out.providerId).toBe('antigravity');
    expect(out.result?.data).toEqual({ greeting: 'from agy' });
    expect(out.attempts[0].provider).toBe('codex');
    expect(out.attempts[0].kind).toBe('timeout');
  });

  it('returns fallback origin when no provider is available', async () => {
    __setCliRunner(async () => cliOk(''));
    run(`UPDATE ai_settings SET provider_priority = ? WHERE id = 1`, JSON.stringify(['openrouter', 'ollama', 'fallback']));
    const out = await completeJsonWithFallback('Say hello', schema);
    expect(out.origin).toBe('fallback');
    expect(out.result).toBeNull();
    expect(out.providerId).toBe('fallback');
    const text = await completeTextWithFallback('Say hello');
    expect(text.origin).toBe('fallback');
  });
});
