import { get } from '../db';
import { recordUsage } from './usage';
import { routeFor, type AiTask, type Route } from './routing';

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface ChatResult { text: string; model: string; tokensIn: number; tokensOut: number }

/** Default request timeout for AI calls (60s per spec). */
export const AI_TIMEOUT_MS = 60000;
const MAX_RETRIES = 2;

export interface AiSettings {
  openrouter_key: string | null;
  openrouter_model: string;
  ollama_base_url: string;
  ollama_model: string;
  default_provider: string;
  fallback_model: string | null;
  redact_pii: boolean;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function retryAfterMs(res: Response, attempt: number): number {
  const ra = res.headers.get('retry-after');
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1000, 5000);
  }
  // Exponential backoff: 500ms, 1000ms (+ jitter-free, deterministic).
  return 500 * 2 ** attempt;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * fetch with retries (max 2 retries) for 429/5xx and transient network errors.
 * Never logs request bodies/headers — API keys are never written to logs.
 */
async function fetchWithRetry(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(url, init, timeoutMs);
      if (!res.ok && isRetryableStatus(res.status) && attempt < MAX_RETRIES) {
        await res.text().catch(() => '');
        await sleep(retryAfterMs(res, attempt));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('AI request failed after retries');
}

export function getAiSettings(): AiSettings {
  const row = get<Record<string, unknown>>(`SELECT * FROM ai_settings WHERE id = 1`);
  return {
    openrouter_key: (row?.openrouter_key as string) || process.env.OPENROUTER_API_KEY || null,
    openrouter_model: (row?.openrouter_model as string) || 'deepseek/deepseek-v4.1-flash',
    ollama_base_url: (row?.ollama_base_url as string) || process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    ollama_model: (row?.ollama_model as string) || 'llama3.1',
    default_provider: (row?.default_provider as string) || 'ollama',
    fallback_model: (row?.fallback_model as string) || null,
    redact_pii: row?.redact_pii === 1 || row?.redact_pii === true,
  };
}

/** True when the routed provider can actually be called (key present for OpenRouter). */
export function isProviderConfigured(route: Route): boolean {
  if (route.provider === 'openrouter') return Boolean(getAiSettings().openrouter_key);
  // Ollama is local; a base URL is always configured. Reachability is only
  // proven by a call — failures fall back to heuristic/template, never crash.
  return Boolean(getAiSettings().ollama_base_url);
}

/** True when any provider is configured for the given task's route. */
export function isAiConfiguredFor(task: AiTask): boolean {
  return isProviderConfigured(routeFor(task));
}

export async function openRouterChat(messages: ChatMessage[], model?: string, task = 'general', timeoutMs = AI_TIMEOUT_MS): Promise<ChatResult> {
  const s = getAiSettings();
  if (!s.openrouter_key) throw new Error('OpenRouter API key not configured');
  const mdl = model || s.openrouter_model;
  const res = await fetchWithRetry('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.openrouter_key}`, 'HTTP-Referer': 'https://interviewhub.local', 'X-Title': 'InterviewHub' },
    body: JSON.stringify({ model: mdl, messages }),
  }, timeoutMs);
  if (!res.ok) throw new Error(`OpenRouter error ${res.status}`);
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const text = data.choices?.[0]?.message?.content ?? '';
  const tin = data.usage?.prompt_tokens ?? 0;
  const tout = data.usage?.completion_tokens ?? 0;
  recordUsage('openrouter', mdl, task, tin, tout);
  return { text, model: mdl, tokensIn: tin, tokensOut: tout };
}

export async function ollamaChat(messages: ChatMessage[], model?: string, task = 'general', timeoutMs = AI_TIMEOUT_MS): Promise<ChatResult> {
  const s = getAiSettings();
  const mdl = model || s.ollama_model;
  const base = s.ollama_base_url.replace(/\/$/, '');
  const res = await fetchWithRetry(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: mdl, messages, stream: false }),
  }, timeoutMs);
  if (!res.ok) throw new Error(`Ollama error ${res.status}`);
  const data = await res.json() as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
  const tin = data.prompt_eval_count ?? 0;
  const tout = data.eval_count ?? 0;
  recordUsage('ollama', mdl, task, tin, tout);
  return { text: data.message?.content ?? '', model: mdl, tokensIn: tin, tokensOut: tout };
}

/** Route a task to its configured provider/model (lib/ai/routing.ts) and call it. */
export async function chatForTask(task: AiTask, messages: ChatMessage[], timeoutMs = AI_TIMEOUT_MS): Promise<ChatResult> {
  const route = routeFor(task);
  if (route.provider === 'openrouter') return openRouterChat(messages, route.model, task, timeoutMs);
  return ollamaChat(messages, route.model, task, timeoutMs);
}

/** Legacy entry: routes to the configured default provider. Prefer chatForTask. */
export async function chat(task: string, messages: ChatMessage[], modelOverride?: string): Promise<ChatResult> {
  const s = getAiSettings();
  if (s.default_provider === 'openrouter') return openRouterChat(messages, modelOverride, task);
  return ollamaChat(messages, modelOverride, task);
}

/** List models from OpenRouter (/models). Key is sent only in the header, never returned/logged. */
export async function listOpenRouterModels(): Promise<string[]> {
  const s = getAiSettings();
  if (!s.openrouter_key) throw new Error('OpenRouter API key not configured');
  const res = await fetchWithRetry('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${s.openrouter_key}` },
  }, 15000);
  if (!res.ok) throw new Error(`OpenRouter error ${res.status}`);
  const data = await res.json() as { data?: Array<{ id?: string }> };
  return (data.data || []).map((m) => m.id || '').filter(Boolean);
}

/** List local models from Ollama (/api/tags). */
export async function listOllamaModels(baseUrl?: string): Promise<string[]> {
  const base = (baseUrl || getAiSettings().ollama_base_url).replace(/\/$/, '');
  const res = await fetchWithRetry(`${base}/api/tags`, {}, 15000);
  if (!res.ok) throw new Error(`Ollama error ${res.status}`);
  const data = await res.json() as { models?: Array<{ name?: string }> };
  return (data.models || []).map((m) => m.name || '').filter(Boolean);
}
