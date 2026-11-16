import { get, parseJson } from '../db';

export type AiTask = 'match' | 'questions' | 'answers' | 'skillgen' | 'star' | 'general';
export interface Route { provider: 'ollama' | 'openrouter'; model: string }

export const DEFAULT_ROUTING: Record<AiTask, Route> = {
  match: { provider: 'ollama', model: 'llama3.1' },
  questions: { provider: 'ollama', model: 'llama3.1' },
  answers: { provider: 'ollama', model: 'llama3.1' },
  skillgen: { provider: 'ollama', model: 'llama3.1' },
  star: { provider: 'ollama', model: 'llama3.1' },
  general: { provider: 'ollama', model: 'llama3.1' },
};

/**
 * Task keys the old AI Settings UI stored (provider-name strings) mapped to
 * the canonical AiTask keys the server routes on. Unknown keys pass through
 * unchanged — only the values are normalised.
 */
export const LEGACY_TASK_KEYS: Record<string, AiTask> = {
  matching: 'match',
  questions: 'questions',
  star_answers: 'star',
  technical_explanations: 'general',
  resume_parsing: 'general',
  jd_extraction: 'general',
};

/**
 * Normalise one stored routing value to the canonical Route shape.
 * Accepts both shapes the system has ever stored:
 * - legacy plain provider string: "ollama" | "openrouter" (model '' means
 *   "use that provider's configured default model" — lib/ai/providers.ts
 *   falls back to the configured model when the route model is empty)
 * - canonical object: { provider, model? }
 * Returns null for anything unrecognised (dropped, never stored).
 */
export function normalizeRoute(value: unknown): Route | null {
  if (typeof value === 'string') {
    const p = value.toLowerCase();
    if (p === 'ollama' || p === 'openrouter') return { provider: p, model: '' };
    return null;
  }
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (rec.provider === 'ollama' || rec.provider === 'openrouter') {
      return { provider: rec.provider, model: typeof rec.model === 'string' ? rec.model : '' };
    }
  }
  return null;
}

/** Normalise a whole stored routing record to the canonical form. */
export function normalizeRoutingInput(input: unknown): Record<string, Route> {
  const out: Record<string, Route> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const route = normalizeRoute(value);
    if (!route) continue;
    out[LEGACY_TASK_KEYS[key] ?? key] = route;
  }
  return out;
}

export function getRouting(): Record<string, Route> {
  const row = get<{ routing: string | null }>(`SELECT routing FROM ai_settings WHERE id = 1`);
  const stored = parseJson<Record<string, unknown>>(row?.routing ?? null, {});
  return { ...DEFAULT_ROUTING, ...normalizeRoutingInput(stored) };
}

export function routeFor(task: AiTask): Route {
  const r = getRouting();
  return r[task] ?? DEFAULT_ROUTING.general;
}
