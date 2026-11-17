export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get } from '@/lib/db';
import { handleError, ApiError } from '@/lib/errors';
import { providerById, type ProviderId } from '@/lib/ai/adapters';

const VALID: ProviderId[] = ['openrouter', 'codex', 'antigravity', 'ollama', 'fallback'];

/**
 * POST /api/ai-settings/test { provider } — Test Connection for one provider.
 * Uses each provider's own testConnection() (OpenRouter /models, Ollama
 * /api/tags, Codex login status + probe, Antigravity models probe).
 * Never returns keys or secrets.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const provider = String(body.provider || 'ollama') as ProviderId;
    if (!VALID.includes(provider)) throw new ApiError(400, 'provider must be one of openrouter, codex, antigravity, ollama, fallback');
    const row = get<Record<string, unknown>>(`SELECT * FROM ai_settings WHERE id = 1`);
    if (provider === 'openrouter' && body.openrouter_key && typeof body.openrouter_key === 'string') {
      // One-off test with an unsaved key: probe /models directly, do not store.
      try {
        const res = await fetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${body.openrouter_key}` }, signal: AbortSignal.timeout(8000) });
        if (!res.ok) return NextResponse.json({ provider, ok: false, detail: `OpenRouter returned HTTP ${res.status}` });
        const data = await res.json() as { data?: Array<{ id: string }> };
        return NextResponse.json({ provider, ok: true, detail: 'OpenRouter reachable', models: (data.data || []).map((m) => m.id).slice(0, 20) });
      } catch {
        return NextResponse.json({ provider, ok: false, detail: 'OpenRouter unreachable (network error or timeout)' });
      }
    }
    void row;
    const result = await providerById(provider).testConnection();
    const out: Record<string, unknown> = { provider, ok: result.ok, detail: result.error || (result.ok ? `${provider} reachable` : 'unavailable') };
    if (result.latencyMs !== undefined) out.latencyMs = result.latencyMs;
    if (result.model) out.model = result.model;
    if (provider === 'antigravity' && result.ok) {
      const agy = providerById('antigravity') as unknown as { listModels?: () => Promise<string[]> };
      if (agy.listModels) out.models = await agy.listModels().catch(() => []);
    }
    return NextResponse.json(out);
  } catch (e) { return handleError(e); }
}
