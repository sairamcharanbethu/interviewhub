export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get } from '@/lib/db';
import { handleError, ApiError } from '@/lib/errors';

async function fetchTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const provider = String(body.provider || 'ollama');
    const row = get<Record<string, unknown>>(`SELECT * FROM ai_settings WHERE id = 1`);
    if (provider === 'openrouter') {
      const key = (body.openrouter_key as string) || (row?.openrouter_key as string) || process.env.OPENROUTER_API_KEY;
      if (!key) throw new ApiError(400, 'OpenRouter key not configured (body or saved settings)');
      try {
        const res = await fetchTimeout('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${key}` } }, 8000);
        if (!res.ok) return NextResponse.json({ provider, ok: false, detail: `OpenRouter returned HTTP ${res.status}` });
        const data = await res.json() as { data?: Array<{ id: string }> };
        const models = (data.data || []).map((m) => m.id).slice(0, 20);
        return NextResponse.json({ provider, ok: true, detail: 'OpenRouter reachable', models });
      } catch {
        return NextResponse.json({ provider, ok: false, detail: 'OpenRouter unreachable (network error or timeout)' });
      }
    }
    if (provider === 'ollama') {
      const base = String(body.ollama_base_url || row?.ollama_base_url || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
      try {
        const res = await fetchTimeout(`${base}/api/tags`, {}, 8000);
        if (!res.ok) return NextResponse.json({ provider, ok: false, detail: `Ollama returned HTTP ${res.status}` });
        const data = await res.json() as { models?: Array<{ name: string }> };
        return NextResponse.json({ provider, ok: true, detail: 'Ollama reachable', models: (data.models || []).map((m) => m.name) });
      } catch {
        return NextResponse.json({ provider, ok: false, detail: 'Ollama unreachable (connection refused or timeout)' });
      }
    }
    throw new ApiError(400, 'provider must be openrouter or ollama');
  } catch (e) { return handleError(e); }
}
