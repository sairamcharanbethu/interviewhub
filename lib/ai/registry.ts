// Provider registry: priority order (stored in ai_settings.provider_priority
// as JSON, user-changeable in AI Settings), first-available selection, and
// completeWithFallback — tries providers in priority order, classifies
// failures, and falls back to the deterministic template path (origin
// 'fallback') instead of ever blocking the workflow.
import { z } from 'zod';
import { get, run, parseJson } from '../db';
import { ALL_PROVIDERS, ProviderError, providerById, type AiProvider, type JsonCompletion, type ProviderId, type TextCompletion } from './adapters';
export type { ProviderId } from './adapters';

export const DEFAULT_PRIORITY: ProviderId[] = ['openrouter', 'codex', 'antigravity', 'ollama', 'fallback'];
export const VALID_PROVIDER_IDS: ProviderId[] = ['openrouter', 'codex', 'antigravity', 'ollama', 'fallback'];

export function getProviderPriority(): ProviderId[] {
  try {
    const row = get<{ provider_priority: string | null }>(`SELECT provider_priority FROM ai_settings WHERE id = 1`);
    const stored = parseJson<unknown>(row?.provider_priority ?? null, null);
    if (Array.isArray(stored)) {
      const clean = stored.filter((p): p is ProviderId => typeof p === 'string' && (VALID_PROVIDER_IDS as string[]).includes(p));
      if (clean.length) {
        for (const p of VALID_PROVIDER_IDS) if (!clean.includes(p)) clean.push(p);
        return clean;
      }
    }
  } catch { /* fall through to default */ }
  return [...DEFAULT_PRIORITY];
}

export function setProviderPriority(priority: ProviderId[]): void {
  const clean = priority.filter((p) => (VALID_PROVIDER_IDS as string[]).includes(p));
  for (const p of VALID_PROVIDER_IDS) if (!clean.includes(p)) clean.push(p);
  run(`UPDATE ai_settings SET provider_priority = ? WHERE id = 1`, JSON.stringify(clean));
}

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  installed: boolean;
  authenticated: boolean;
  authStatus: string;
  available: boolean;
  detail?: string;
  model?: string | null;
}

export async function getProviderStatuses(): Promise<ProviderStatus[]> {
  const out: ProviderStatus[] = [];
  for (const p of ALL_PROVIDERS) {
    try {
      const av = await p.isAvailable();
      out.push({ id: p.id, name: p.name, installed: av.installed, authenticated: av.authenticated, authStatus: av.authStatus, available: av.available, detail: av.detail });
    } catch (e) {
      out.push({ id: p.id, name: p.name, installed: false, authenticated: false, authStatus: 'not_verified', available: false, detail: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/** First provider in priority order that reports available. Null when only the fallback is left. */
export async function selectProvider(priority: ProviderId[] = getProviderPriority()): Promise<AiProvider | null> {
  for (const id of priority) {
    if (id === 'fallback') continue;
    const p = providerById(id);
    try {
      const av = await p.isAvailable();
      if (av.available) return p;
    } catch { /* try next */ }
  }
  return null;
}

export interface FallbackCompletion<T = JsonCompletion> {
  result: T | null;
  providerId: ProviderId;
  model: string | null;
  origin: 'ai' | 'fallback';
  attempts: Array<{ provider: ProviderId; kind: string; message: string }>;
}

export async function completeJsonWithFallback(
  prompt: string,
  schema: z.ZodType,
  opts?: { timeoutMs?: number; model?: string; priority?: ProviderId[] },
): Promise<FallbackCompletion<JsonCompletion>> {
  const attempts: FallbackCompletion['attempts'] = [];
  for (const id of opts?.priority ?? getProviderPriority()) {
    if (id === 'fallback') continue;
    const p = providerById(id);
    try {
      const av = await p.isAvailable();
      if (!av.available) { attempts.push({ provider: id, kind: 'unavailable', message: av.detail || 'not available' }); continue; }
      const r = await p.completeJson(prompt, schema, { timeoutMs: opts?.timeoutMs, model: opts?.model });
      return { result: r, providerId: id, model: r.model, origin: 'ai', attempts };
    } catch (e) {
      const kind = e instanceof ProviderError ? e.kind : 'unavailable';
      attempts.push({ provider: id, kind, message: e instanceof Error ? e.message : String(e) });
      // Auth/quota/timeout/unavailable/invalid output all fall through to
      // the next provider; nothing here retries the same provider.
      continue;
    }
  }
  return { result: null, providerId: 'fallback', model: null, origin: 'fallback', attempts };
}

export async function completeTextWithFallback(
  prompt: string,
  opts?: { timeoutMs?: number; model?: string; priority?: ProviderId[] },
): Promise<FallbackCompletion<TextCompletion>> {
  const attempts: FallbackCompletion<TextCompletion>['attempts'] = [];
  for (const id of opts?.priority ?? getProviderPriority()) {
    if (id === 'fallback') continue;
    const p = providerById(id);
    try {
      const av = await p.isAvailable();
      if (!av.available) { attempts.push({ provider: id, kind: 'unavailable', message: av.detail || 'not available' }); continue; }
      const r = await p.completeText(prompt, { timeoutMs: opts?.timeoutMs, model: opts?.model });
      return { result: r, providerId: id, model: r.model, origin: 'ai', attempts };
    } catch (e) {
      const kind = e instanceof ProviderError ? e.kind : 'unavailable';
      attempts.push({ provider: id, kind, message: e instanceof Error ? e.message : String(e) });
      continue;
    }
  }
  return { result: null, providerId: 'fallback', model: null, origin: 'fallback', attempts };
}
