// Provider adapters: one modular interface per AI backend.
// OpenRouter/Ollama wrap the existing HTTP providers; Codex and Antigravity
// are CLI subprocess adapters per the verified 2026-11-17 facts. The
// deterministic fallback adapter never pretends to be AI: its complete*
// methods throw a marker error so callers use template logic instead.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import { getAiSettings, openRouterChat, ollamaChat, type ChatMessage } from './providers';
import { extractJsonValue } from './json';
import { runCli, whichCli, makeCliTempDir } from './cli';
import { recordUsage } from './usage';

export type ProviderId = 'openrouter' | 'codex' | 'antigravity' | 'ollama' | 'fallback';
export type AuthStatus = 'authenticated' | 'not_authenticated' | 'not_verified';
export type FailureKind = 'auth_expired' | 'quota' | 'timeout' | 'unavailable' | 'invalid_output' | 'fallback';

export interface Availability {
  available: boolean;
  installed: boolean;
  authenticated: boolean;
  authStatus: AuthStatus;
  detail?: string;
}
export interface TestConnectionResult { ok: boolean; latencyMs?: number; model?: string; error?: string }
export interface JsonCompletion { data: unknown; provider: ProviderId; model: string; rawTokens?: { in: number; out: number } }
export interface TextCompletion { text: string; provider: ProviderId; model: string }

export interface AiProvider {
  id: ProviderId;
  name: string;
  isAvailable(): Promise<Availability>;
  testConnection(): Promise<TestConnectionResult>;
  completeJson(prompt: string, schema: z.ZodType, opts?: { timeoutMs?: number; model?: string }): Promise<JsonCompletion>;
  completeText(prompt: string, opts?: { timeoutMs?: number; model?: string }): Promise<TextCompletion>;
}

export class ProviderError extends Error {
  kind: FailureKind;
  provider: ProviderId;
  constructor(provider: ProviderId, kind: FailureKind, message: string) {
    super(message);
    this.provider = provider;
    this.kind = kind;
  }
}

/** Module-level semaphore: at most 1 CLI call at a time per provider. */
const cliLocks = new Map<string, Promise<unknown>>();
export function withCliLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = cliLocks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  cliLocks.set(key, run.catch(() => undefined));
  return run;
}

function classifyCliError(provider: ProviderId, e: unknown): ProviderError {
  const msg = e instanceof Error ? e.message : String(e);
  if (/authenticat|login|not signed in|unauthorized|401/i.test(msg)) return new ProviderError(provider, 'auth_expired', msg);
  if (/quota|rate limit|limit|429/i.test(msg)) return new ProviderError(provider, 'quota', msg);
  if (/timeout|ETIMEDOUT|timed out/i.test(msg) || (e as { kind?: string })?.kind === 'timeout') return new ProviderError(provider, 'timeout', msg);
  return new ProviderError(provider, 'unavailable', msg);
}

function parseJsonStrict(provider: ProviderId, text: string, schema: z.ZodType): unknown {
  const raw = extractJsonValue(text);
  if (!raw) throw new ProviderError(provider, 'invalid_output', 'Provider returned no JSON');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new ProviderError(provider, 'invalid_output', 'Provider returned malformed JSON'); }
  const v = schema.safeParse(parsed);
  if (!v.success) throw new ProviderError(provider, 'invalid_output', `Provider JSON failed validation: ${v.error.issues.slice(0, 3).map((i) => i.message).join('; ')}`);
  return v.data;
}

const CODEX_TIMEOUT_MS = 120_000;
const AGY_TIMEOUT_MS = 600_000;

function agyPath(): string {
  return path.join(os.homedir(), '.local', 'bin', 'agy');
}

// ---------------------------------------------------------------- OpenRouter
export const openRouterProvider: AiProvider = {
  id: 'openrouter',
  name: 'OpenRouter',
  async isAvailable() {
    const key = getAiSettings().openrouter_key;
    if (!key) return { available: false, installed: true, authenticated: false, authStatus: 'not_authenticated', detail: 'No OpenRouter API key configured' };
    return { available: true, installed: true, authenticated: true, authStatus: 'authenticated', detail: 'API key configured' };
  },
  async testConnection() {
    const start = Date.now();
    const s = getAiSettings();
    if (!s.openrouter_key) return { ok: false, error: 'OpenRouter API key not configured' };
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${s.openrouter_key}` }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) return { ok: false, error: `OpenRouter returned HTTP ${res.status}` };
      return { ok: true, latencyMs: Date.now() - start, model: s.openrouter_model };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'unreachable' }; }
  },
  async completeJson(prompt, schema, opts) {
    const s = getAiSettings();
    const model = opts?.model || s.openrouter_model;
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Answer only, do not use tools. Respond with JSON only, matching the requested schema. No preamble, no markdown fences.' },
      { role: 'user', content: prompt },
    ];
    try {
      const r = await openRouterChat(messages, model, 'general', opts?.timeoutMs ?? 60000);
      return { data: parseJsonStrict('openrouter', r.text, schema), provider: 'openrouter', model: r.model, rawTokens: { in: r.tokensIn, out: r.tokensOut } };
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/401|403/i.test(msg)) throw new ProviderError('openrouter', 'auth_expired', msg);
      if (/429/i.test(msg)) throw new ProviderError('openrouter', 'quota', msg);
      throw new ProviderError('openrouter', 'unavailable', msg);
    }
  },
  async completeText(prompt, opts) {
    const s = getAiSettings();
    const model = opts?.model || s.openrouter_model;
    const r = await openRouterChat([
      { role: 'system', content: 'Answer only, do not use tools.' },
      { role: 'user', content: prompt },
    ], model, 'general', opts?.timeoutMs ?? 60000);
    return { text: r.text, provider: 'openrouter', model: r.model };
  },
};

// ------------------------------------------------------------------- Ollama
export const ollamaProvider: AiProvider = {
  id: 'ollama',
  name: 'Ollama',
  async isAvailable() {
    const base = getAiSettings().ollama_base_url.replace(/\/$/, '');
    try {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return { available: false, installed: true, authenticated: true, authStatus: 'authenticated', detail: `Ollama returned HTTP ${res.status}` };
      return { available: true, installed: true, authenticated: true, authStatus: 'authenticated', detail: 'Ollama reachable' };
    } catch {
      return { available: false, installed: false, authenticated: false, authStatus: 'not_verified', detail: 'Ollama unreachable — is it running?' };
    }
  },
  async testConnection() {
    const start = Date.now();
    const s = getAiSettings();
    try {
      const res = await fetch(`${s.ollama_base_url.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return { ok: false, error: `Ollama returned HTTP ${res.status}` };
      return { ok: true, latencyMs: Date.now() - start, model: s.ollama_model };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'unreachable' }; }
  },
  async completeJson(prompt, schema, opts) {
    const s = getAiSettings();
    const model = opts?.model || s.ollama_model;
    try {
      const r = await ollamaChat([
        { role: 'system', content: 'Answer only, do not use tools. Respond with JSON only, matching the requested schema.' },
        { role: 'user', content: prompt },
      ], model, 'general', opts?.timeoutMs ?? 60000);
      return { data: parseJsonStrict('ollama', r.text, schema), provider: 'ollama', model: r.model, rawTokens: { in: r.tokensIn, out: r.tokensOut } };
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError('ollama', 'unavailable', e instanceof Error ? e.message : String(e));
    }
  },
  async completeText(prompt, opts) {
    const s = getAiSettings();
    const r = await ollamaChat([
      { role: 'system', content: 'Answer only, do not use tools.' },
      { role: 'user', content: prompt },
    ], opts?.model || s.ollama_model, 'general', opts?.timeoutMs ?? 60000);
    return { text: r.text, provider: 'ollama', model: r.model };
  },
};

// --------------------------------------------------------------------- Codex
export const codexProvider: AiProvider = {
  id: 'codex',
  name: 'Codex CLI',
  async isAvailable() {
    const exe = await whichCli('codex');
    if (!exe) return { available: false, installed: false, authenticated: false, authStatus: 'not_authenticated', detail: 'codex CLI not found on PATH — run `codex login` on the Mac after installing it' };
    try {
      const r = await runCli(exe, ['login', 'status'], { timeoutMs: 15000 });
      if (r.code === 0) return { available: true, installed: true, authenticated: true, authStatus: 'authenticated', detail: 'Signed in to ChatGPT via codex login' };
      return { available: false, installed: true, authenticated: false, authStatus: 'not_authenticated', detail: 'codex CLI installed but not signed in — run `codex login`' };
    } catch {
      return { available: false, installed: true, authenticated: false, authStatus: 'not_verified', detail: 'Could not verify codex login status' };
    }
  },
  async testConnection() {
    const start = Date.now();
    const av = await this.isAvailable();
    if (!av.available) return { ok: false, error: av.detail };
    try {
      const r = await this.completeText('Reply with exactly: ok', { timeoutMs: 60000 });
      return { ok: true, latencyMs: Date.now() - start, model: r.model };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  },
  async completeJson(prompt, schema, opts) {
    return withCliLock('codex', async () => {
      const exe = await whichCli('codex');
      if (!exe) throw new ProviderError('codex', 'unavailable', 'codex CLI not installed');
      const dir = makeCliTempDir();
      const schemaFile = path.join(dir, 'schema.json');
      const answerFile = path.join(dir, 'answer.json');
      fs.writeFileSync(schemaFile, JSON.stringify(zodToJsonSchema(schema)), 'utf8');
      const args = ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--color', 'never', '--output-schema', schemaFile, '-o', answerFile, '--json', prompt];
      if (opts?.model) args.splice(2, 0, '-m', opts.model);
      let result;
      try {
        result = await runCli(exe, args, { timeoutMs: opts?.timeoutMs ?? CODEX_TIMEOUT_MS, cwd: dir });
      } catch (e) { throw classifyCliError('codex', e); }
      if (result.code !== 0) throw classifyCliError('codex', new Error(`codex exec exited ${result.code}: ${result.stderr.slice(0, 500)}`));
      let text = result.stdout;
      try { if (fs.existsSync(answerFile)) text = fs.readFileSync(answerFile, 'utf8'); } catch { /* use stdout */ }
      if (/turn\.failed|authentication|not signed in/i.test(text) && !extractJsonValue(text)) throw new ProviderError('codex', 'auth_expired', 'Codex turn failed (auth or limit)');
      return { data: parseJsonStrict('codex', text, schema), provider: 'codex' as const, model: opts?.model || 'codex-default' };
    });
  },
  async completeText(prompt, opts) {
    return withCliLock('codex', async () => {
      const exe = await whichCli('codex');
      if (!exe) throw new ProviderError('codex', 'unavailable', 'codex CLI not installed');
      const dir = makeCliTempDir();
      const args = ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--color', 'never', prompt];
      if (opts?.model) args.splice(2, 0, '-m', opts.model);
      let result;
      try {
        result = await runCli(exe, args, { timeoutMs: opts?.timeoutMs ?? CODEX_TIMEOUT_MS, cwd: dir });
      } catch (e) { throw classifyCliError('codex', e); }
      if (result.code !== 0) throw classifyCliError('codex', new Error(`codex exec exited ${result.code}: ${result.stderr.slice(0, 500)}`));
      return { text: result.stdout, provider: 'codex' as const, model: opts?.model || 'codex-default' };
    });
  },
};

// --------------------------------------------------------------- Antigravity
export const antigravityProvider: AiProvider = {
  id: 'antigravity',
  name: 'Antigravity CLI',
  async isAvailable() {
    const exe = await whichCli('agy', [agyPath()]);
    if (!exe) return { available: false, installed: false, authenticated: false, authStatus: 'not_authenticated', detail: 'agy CLI not found (~/.local/bin/agy) — install the Antigravity app and sign in' };
    try {
      const r = await runCli(exe, ['models'], { timeoutMs: 30000 });
      if (r.code === 0) return { available: true, installed: true, authenticated: true, authStatus: 'authenticated', detail: 'Antigravity signed in (agy models succeeded)' };
      if (/authenticat|sign in|login/i.test(r.stderr + r.stdout)) return { available: false, installed: true, authenticated: false, authStatus: 'not_authenticated', detail: 'Antigravity not signed in — sign in to the Antigravity app' };
      return { available: false, installed: true, authenticated: false, authStatus: 'not_verified', detail: `agy models exited ${r.code}` };
    } catch {
      return { available: false, installed: true, authenticated: false, authStatus: 'not_verified', detail: 'Could not probe agy' };
    }
  },
  async testConnection() {
    const start = Date.now();
    const av = await this.isAvailable();
    if (!av.available) return { ok: false, error: av.detail };
    try {
      const r = await this.completeText('Reply with exactly: ok', { timeoutMs: 120000 });
      return { ok: true, latencyMs: Date.now() - start, model: r.model };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  },
  async completeJson(prompt, schema, opts) {
    return withCliLock('antigravity', async () => {
      const exe = await whichCli('agy', [agyPath()]);
      if (!exe) throw new ProviderError('antigravity', 'unavailable', 'agy CLI not installed');
      const schemaJson = JSON.stringify(zodToJsonSchema(schema));
      const args = ['-p', prompt, '--output-format', 'json', '--json-schema', schemaJson, '--print-timeout', '10m'];
      if (opts?.model) args.push('--model', opts.model);
      let result;
      try {
        result = await runCli(exe, args, { timeoutMs: opts?.timeoutMs ?? AGY_TIMEOUT_MS, cwd: makeCliTempDir() });
      } catch (e) { throw classifyCliError('antigravity', e); }
      if (result.code !== 0) throw classifyCliError('antigravity', new Error(`agy exited ${result.code}: ${result.stderr.slice(0, 500)}`));
      let parsed: unknown;
      try { parsed = JSON.parse(result.stdout); } catch { throw new ProviderError('antigravity', 'invalid_output', 'agy returned non-JSON output'); }
      const env = parsed as Record<string, unknown>;
      if (typeof env.status === 'string' && env.status.toUpperCase() !== 'SUCCESS') {
        throw classifyCliError('antigravity', new Error(`agy status ${String(env.status)}: ${JSON.stringify(env).slice(0, 500)}`));
      }
      const structured = env.structured_output ?? env.output ?? env.result;
      const text = typeof structured === 'string' ? structured : JSON.stringify(structured ?? {});
      return { data: parseJsonStrict('antigravity', text, schema), provider: 'antigravity' as const, model: opts?.model || 'antigravity-default' };
    });
  },
  async completeText(prompt, opts) {
    return withCliLock('antigravity', async () => {
      const exe = await whichCli('agy', [agyPath()]);
      if (!exe) throw new ProviderError('antigravity', 'unavailable', 'agy CLI not installed');
      const args = ['-p', prompt, '--output-format', 'json', '--print-timeout', '10m'];
      if (opts?.model) args.push('--model', opts.model);
      let result;
      try {
        result = await runCli(exe, args, { timeoutMs: opts?.timeoutMs ?? AGY_TIMEOUT_MS, cwd: makeCliTempDir() });
      } catch (e) { throw classifyCliError('antigravity', e); }
      if (result.code !== 0) throw classifyCliError('antigravity', new Error(`agy exited ${result.code}: ${result.stderr.slice(0, 500)}`));
      let parsed: unknown;
      try { parsed = JSON.parse(result.stdout); } catch { return { text: result.stdout, provider: 'antigravity' as const, model: opts?.model || 'antigravity-default' }; }
      const env = parsed as Record<string, unknown>;
      const out = env.output ?? env.structured_output ?? env.result ?? '';
      return { text: typeof out === 'string' ? out : JSON.stringify(out), provider: 'antigravity' as const, model: opts?.model || 'antigravity-default' };
    });
  },
  /** Live model list (never hardcoded). Returns [] on failure. */
  async listModels(): Promise<string[]> {
    const exe = await whichCli('agy', [agyPath()]);
    if (!exe) return [];
    try {
      const r = await runCli(exe, ['models'], { timeoutMs: 30000 });
      if (r.code !== 0) return [];
      const parsed = JSON.parse(r.stdout) as unknown;
      if (Array.isArray(parsed)) return parsed.map((m) => String((m as Record<string, unknown>).name ?? (m as Record<string, unknown>).id ?? m)).filter(Boolean);
      if (parsed && typeof parsed === 'object') {
        const models = (parsed as Record<string, unknown>).models;
        if (Array.isArray(models)) return models.map((m) => String((m as Record<string, unknown>).name ?? (m as Record<string, unknown>).id ?? m)).filter(Boolean);
      }
      return r.stdout.split('\n').map((l) => l.trim()).filter((l) => l && !/^[{[]/.test(l)).slice(0, 50);
    } catch { return []; }
  },
} as AiProvider & { listModels(): Promise<string[]> };

// ------------------------------------------------------------------ Fallback
export const fallbackProvider: AiProvider = {
  id: 'fallback',
  name: 'Template fallback',
  async isAvailable() {
    return { available: true, installed: true, authenticated: true, authStatus: 'authenticated', detail: 'Deterministic template fallback is always available' };
  },
  async testConnection() { return { ok: true, model: 'template' }; },
  async completeJson() {
    throw new ProviderError('fallback', 'fallback', 'No AI provider available — use the deterministic/template fallback');
  },
  async completeText() {
    throw new ProviderError('fallback', 'fallback', 'No AI provider available — use the deterministic/template fallback');
  },
};

export const ALL_PROVIDERS: AiProvider[] = [openRouterProvider, codexProvider, antigravityProvider, ollamaProvider, fallbackProvider];
export function providerById(id: ProviderId): AiProvider {
  return ALL_PROVIDERS.find((p) => p.id === id) ?? fallbackProvider;
}

/** Minimal Zod → JSON Schema conversion for --output-schema / --json-schema.
 *  Only the shapes used by InterviewHub extraction schemas are needed. */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;
  const typeName = def?.typeName as string | undefined;
  if (typeName === 'ZodObject') {
    const shape = (schema as unknown as { shape: Record<string, z.ZodType> }).shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      properties[k] = zodToJsonSchema(v);
      const inner = (v as unknown as { _def: Record<string, unknown> })._def;
      if (inner?.typeName !== 'ZodOptional' && inner?.typeName !== 'ZodDefault') required.push(k);
    }
    return { type: 'object', properties, required };
  }
  if (typeName === 'ZodArray') {
    const inner = (def as { type: unknown }).type as z.ZodType;
    return { type: 'array', items: zodToJsonSchema(inner) };
  }
  if (typeName === 'ZodOptional' || typeName === 'ZodDefault' || typeName === 'ZodNullable') {
    const inner = (def as { innerType: z.ZodType }).innerType;
    return zodToJsonSchema(inner);
  }
  if (typeName === 'ZodString') return { type: 'string' };
  if (typeName === 'ZodNumber') return { type: 'number' };
  if (typeName === 'ZodBoolean') return { type: 'boolean' };
  if (typeName === 'ZodEnum') return { type: 'string', enum: (def as { values: string[] }).values };
  if (typeName === 'ZodUnion') {
    const opts = (def as { options: z.ZodType[] }).options;
    return { anyOf: opts.map(zodToJsonSchema) };
  }
  if (typeName === 'ZodRecord') return { type: 'object' };
  return { type: 'string' };
}

export function __recordCliUsage(provider: ProviderId, model: string, task: string, tin: number, tout: number): void {
  try { recordUsage(provider, model, task, tin, tout); } catch { /* usage is advisory */ }
}
