import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTempDir, jsonBody, jsonReq, makeTempDataDir } from '../helpers';

const dir = makeTempDataDir();
afterAll(() => cleanupTempDir(dir));

const { GET: getAiSettings, POST: saveAiSettings } = await import('@/app/api/ai-settings/route');
const { POST: exportBackup } = await import('@/app/api/backup/export/route');
const { getAiSettings: readSettings, getSecretStorageInfo } = await import('@/lib/ai/providers');
const dbLib = await import('@/lib/db');

const KEY = 'sk-or-test-KEY-1234567890abcdef';

describe('ai-settings security: encryption at rest + no key in responses', () => {
  it('POST stores the key encrypted; GET never returns it', async () => {
    const res = await saveAiSettings(jsonReq('http://localhost/api/ai-settings', 'POST', { openrouter_key: KEY }));
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(JSON.stringify(body)).not.toContain(KEY);
    const saved = body.ai_settings as Record<string, unknown>;
    expect(saved.has_openrouter_key).toBe(true);
    expect(saved.openrouter_key_last4).toBe('cdef');

    const row = dbLib.get<{ openrouter_key: string }>(`SELECT openrouter_key FROM ai_settings WHERE id = 1`);
    expect(row!.openrouter_key).not.toBe(KEY);
    expect(row!.openrouter_key.startsWith('v1:')).toBe(true);

    // The stored value still decrypts to the real key for API calls.
    expect(readSettings().openrouter_key).toBe(KEY);
    expect(getSecretStorageInfo()).toEqual({ storage: 'file', has_key: true });

    const get = await getAiSettings();
    expect(get.status).toBe(200);
    expect(JSON.stringify(await jsonBody(get))).not.toContain(KEY);
  });

  it('backup export excludes the key (plaintext and encrypted alike)', async () => {
    const row = dbLib.get<{ openrouter_key: string }>(`SELECT openrouter_key FROM ai_settings WHERE id = 1`);
    expect(row!.openrouter_key).toBeTruthy();
    const exp = await exportBackup();
    expect(exp.status).toBe(200);
    const text = JSON.stringify(await jsonBody(exp));
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(row!.openrouter_key);
    expect(text).not.toContain('openrouter_key');
  });

  it("'' clears the stored key", async () => {
    const res = await saveAiSettings(jsonReq('http://localhost/api/ai-settings', 'POST', { openrouter_key: '' }));
    expect(res.status).toBe(200);
    const saved = (await jsonBody(res)).ai_settings as Record<string, unknown>;
    expect(saved.has_openrouter_key).toBe(false);
    expect(saved.openrouter_key_last4).toBeNull();
    const row = dbLib.get<{ openrouter_key: string | null }>(`SELECT openrouter_key FROM ai_settings WHERE id = 1`);
    expect(row!.openrouter_key).toBeNull();
    expect(readSettings().openrouter_key).toBeNull();
    expect(getSecretStorageInfo()).toEqual({ storage: 'none', has_key: false });
  });
});
