import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTempDir, jsonBody, jsonReq, makeTempDataDir } from '../helpers';

const dir = makeTempDataDir();
afterAll(() => cleanupTempDir(dir));

const { GET: getAiSettings, POST: saveAiSettings } = await import('@/app/api/ai-settings/route');
const { GET: listModels } = await import('@/app/api/ai-settings/models/route');
const dbLib = await import('@/lib/db');

type Settings = Record<string, unknown>;

describe('ai-settings routing round-trip', () => {
  it('accepts legacy provider-string routing and returns the canonical form', async () => {
    const res = await saveAiSettings(jsonReq('http://localhost/api/ai-settings', 'POST', {
      routing: { match: 'openrouter', questions: 'ollama' },
    }));
    expect(res.status).toBe(200);
    const saved = (await jsonBody(res)).ai_settings as Settings;
    expect(saved.routing).toEqual({
      match: { provider: 'openrouter', model: '' },
      questions: { provider: 'ollama', model: '' },
    });
    // Stored canonically in the DB too.
    const row = dbLib.get<{ routing: string }>(`SELECT routing FROM ai_settings WHERE id = 1`);
    expect(JSON.parse(row!.routing)).toEqual({
      match: { provider: 'openrouter', model: '' },
      questions: { provider: 'ollama', model: '' },
    });
  });

  it('accepts canonical {provider, model} routing and maps legacy task keys', async () => {
    const res = await saveAiSettings(jsonReq('http://localhost/api/ai-settings', 'POST', {
      routing: { matching: { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash' }, star: { provider: 'ollama', model: 'llama3.1' } },
    }));
    expect(res.status).toBe(200);
    const saved = (await jsonBody(res)).ai_settings as Settings;
    expect((saved.routing as Record<string, unknown>).match).toEqual({ provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash' });
    expect((saved.routing as Record<string, unknown>).star).toEqual({ provider: 'ollama', model: 'llama3.1' });
  });

  it('rejects an unknown provider in routing', async () => {
    const res = await saveAiSettings(jsonReq('http://localhost/api/ai-settings', 'POST', { routing: { match: 'anthropic' } }));
    expect(res.status).toBe(400);
  });

  it('never returns the OpenRouter key in the GET response', async () => {
    const res = await getAiSettings();
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(JSON.stringify(body)).not.toContain('sk-or');
    expect((body.ai_settings as Settings).has_openrouter_key).toBe(false);
  });

  it('models endpoint fails gracefully when the provider is unreachable', async () => {
    // No Ollama is running in the test sandbox; the endpoint must answer
    // ok:false with a detail instead of a 500.
    const res = await listModels(new Request('http://localhost/api/ai-settings/models?provider=ollama'));
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.provider).toBe('ollama');
    expect(body.ok).toBe(false);
    expect(body.models).toEqual([]);
    expect(body.detail as string).toBeTruthy();
  });

  it('models endpoint rejects an unknown provider', async () => {
    const res = await listModels(new Request('http://localhost/api/ai-settings/models?provider=anthropic'));
    expect(res.status).toBe(400);
  });
});
