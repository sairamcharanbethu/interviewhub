import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupTempDir, makeTempDataDir } from '../helpers';

const dir = makeTempDataDir();
afterAll(() => cleanupTempDir(dir));

const providers = await import('@/lib/ai/providers');
const { get, run } = await import('@/lib/db');

const MESSAGES = [{ role: 'user' as const, content: 'Say hi.' }];

type FetchMock = (...args: unknown[]) => Promise<unknown>;
let originalFetch: typeof fetch;

function mockResponse(opts: {
  status?: number;
  json?: unknown;
  jsonThrows?: Error;
  headers?: Record<string, string>;
}): Response {
  const status = opts.status ?? 200;
  const headersMap = new Map(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headersMap.get(name.toLowerCase()) ?? null },
    text: async () => (typeof opts.json === 'string' ? opts.json : JSON.stringify(opts.json ?? {})),
    json: async () => {
      if (opts.jsonThrows) throw opts.jsonThrows;
      return opts.json ?? {};
    },
  } as unknown as Response;
}

function openRouterOk(overrides: Record<string, unknown> = {}): Response {
  return mockResponse({
    json: {
      choices: [{ message: { content: 'Hello from OpenRouter' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      ...overrides,
    },
  });
}

function ollamaOk(overrides: Record<string, unknown> = {}): Response {
  return mockResponse({
    json: {
      message: { content: 'Hello from Ollama' },
      prompt_eval_count: 7,
      eval_count: 3,
      ...overrides,
    },
  });
}

/** Route every fetch by URL substring. */
function fetchByUrl(handlers: Array<[string, FetchMock]>): FetchMock {
  return async (url: unknown) => {
    const u = String(url);
    for (const [substr, handler] of handlers) {
      if (u.includes(substr)) return handler(u);
    }
    throw new Error(`Unexpected fetch URL in test: ${u}`);
  };
}

function usageCount(): number {
  return (get<{ n: number }>(`SELECT COUNT(*) AS n FROM ai_usage`)?.n ?? 0) as number;
}

/** Point the 'general' task at OpenRouter so fallback tests exercise both providers. */
function routeGeneralToOpenRouter(): void {
  run(
    `UPDATE ai_settings SET routing = ? WHERE id = 1`,
    JSON.stringify({ general: { provider: 'openrouter', model: 'test-model' } }),
  );
}

function routeGeneralToOllama(): void {
  run(`UPDATE ai_settings SET routing = ? WHERE id = 1`, JSON.stringify({ general: { provider: 'ollama', model: 'llama3.1' } }));
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  // OpenRouter tests need a key; getAiSettings() reads env per call.
  process.env.OPENROUTER_API_KEY = 'test-key-do-not-use';
  routeGeneralToOllama();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.OPENROUTER_API_KEY;
  vi.restoreAllMocks();
});

describe('openRouterChat', () => {
  it('succeeds and records usage in ai_usage', async () => {
    const fetchMock = vi.fn(async () => openRouterOk());
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const before = usageCount();
    const res = await providers.openRouterChat(MESSAGES, 'test-model', 'general');
    expect(res.text).toBe('Hello from OpenRouter');
    expect(res.model).toBe('test-model');
    expect(res.tokensIn).toBe(10);
    expect(res.tokensOut).toBe(5);
    expect(usageCount()).toBe(before + 1);
    const row = get<Record<string, unknown>>(`SELECT provider, model, task FROM ai_usage ORDER BY rowid DESC LIMIT 1`);
    expect(row?.provider).toBe('openrouter');
    expect(row?.task).toBe('general');
  });

  it('invalid key (401) throws with the status in the message and does not retry', async () => {
    const fetchMock = vi.fn(async () => mockResponse({ status: 401, json: { error: 'bad key' } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const before = usageCount();
    await expect(providers.openRouterChat(MESSAGES, 'test-model', 'general')).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(usageCount()).toBe(before);
  });

  it('malformed JSON response throws and records no usage', async () => {
    const fetchMock = vi.fn(async () =>
      mockResponse({ jsonThrows: new SyntaxError('Unexpected token < in JSON') }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const before = usageCount();
    await expect(providers.openRouterChat(MESSAGES, 'test-model', 'general')).rejects.toThrow();
    expect(usageCount()).toBe(before);
  });

  it('empty choices content returns empty text (callers treat it as no-AI)', async () => {
    const fetchMock = vi.fn(async () =>
      openRouterOk({ choices: [{ message: { content: '' } }], usage: { prompt_tokens: 1, completion_tokens: 0 } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const res = await providers.openRouterChat(MESSAGES, 'test-model', 'general');
    expect(res.text).toBe('');
  });

  it('429 with Retry-After retries once then succeeds (fetch called 2x)', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return mockResponse({ status: 429, headers: { 'retry-after': '1' }, json: {} });
      return openRouterOk();
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const res = await providers.openRouterChat(MESSAGES, 'test-model', 'general');
    expect(res.text).toBe('Hello from OpenRouter');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('ollamaChat', () => {
  it('connection refused throws', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const before = usageCount();
    await expect(providers.ollamaChat(MESSAGES, 'llama3.1', 'general')).rejects.toThrow(/fetch failed/);
    expect(usageCount()).toBe(before);
  });

  it('model missing (404) throws with the status in the message', async () => {
    const fetchMock = vi.fn(async () => mockResponse({ status: 404, json: { error: 'model not found' } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const before = usageCount();
    await expect(providers.ollamaChat(MESSAGES, 'no-such-model', 'general')).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(usageCount()).toBe(before);
  });

  it('timeout (fetch never resolves + short timeoutMs) aborts', async () => {
    const fetchMock = vi.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(providers.ollamaChat(MESSAGES, 'llama3.1', 'general', 50)).rejects.toThrow(/abort/i);
  });
});

describe('chatForTaskWithFallback', () => {
  it('OpenRouter fails, Ollama succeeds', async () => {
    routeGeneralToOpenRouter();
    const fetchMock = vi.fn(
      fetchByUrl([
        ['openrouter.ai', async () => mockResponse({ status: 401, json: { error: 'bad key' } })],
        ['/api/chat', async () => ollamaOk()],
      ]),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const before = usageCount();
    const res = await providers.chatForTaskWithFallback('general', MESSAGES);
    expect(res.text).toBe('Hello from Ollama');
    expect(res.model).toBe('llama3.1');
    expect(usageCount()).toBe(before + 1);
    const row = get<Record<string, unknown>>(`SELECT provider FROM ai_usage ORDER BY rowid DESC LIMIT 1`);
    expect(row?.provider).toBe('ollama');
  });

  it('both fail: throws with both errors attached and records no usage', async () => {
    routeGeneralToOpenRouter();
    const fetchMock = vi.fn(
      fetchByUrl([
        ['openrouter.ai', async () => mockResponse({ status: 401, json: { error: 'bad key' } })],
        ['/api/chat', async () => mockResponse({ status: 404, json: { error: 'model not found' } })],
      ]),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const before = usageCount();
    let caught: unknown;
    try {
      await providers.chatForTaskWithFallback('general', MESSAGES);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/openrouter/i);
    expect((caught as Error).message).toMatch(/ollama/i);
    const causes = (caught as unknown as { causes?: unknown[] }).causes;
    expect(Array.isArray(causes) && causes.length).toBe(2);
    expect(usageCount()).toBe(before);
  });
});
