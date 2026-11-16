export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get, run } from '@/lib/db';
import { aiSettingsSchema } from '@/lib/validation';
import { normalizeRoutingInput } from '@/lib/ai/routing';
import { handleError, parseJsonBody } from '@/lib/errors';
import { maskKey } from '@/lib/security';

function publicSettings(row: Record<string, unknown>) {
  const { has_key, last4 } = maskKey(row.openrouter_key as string | null);
  // Normalise routing to the canonical {provider, model} form on read, so
  // legacy string-form rows (stored before the reconciliation) round-trip.
  let routing: Record<string, { provider: string; model: string }> | null = null;
  if (row.routing) {
    try { routing = normalizeRoutingInput(JSON.parse(row.routing as string)); } catch { routing = null; }
  }
  return {
    id: 1,
    openrouter_model: row.openrouter_model,
    ollama_base_url: row.ollama_base_url,
    ollama_model: row.ollama_model,
    default_provider: row.default_provider,
    routing,
    fallback_model: row.fallback_model,
    redact_pii: row.redact_pii === 1,
    has_openrouter_key: has_key,
    openrouter_key_last4: last4,
  };
}

export async function GET() {
  try {
    const row = get<Record<string, unknown>>(`SELECT * FROM ai_settings WHERE id = 1`)!;
    return NextResponse.json({ ai_settings: publicSettings(row) });
  } catch (e) { return handleError(e); }
}

export async function POST(req: Request) {
  try {
    const body = await parseJsonBody(req, aiSettingsSchema);
    const cur = get<Record<string, unknown>>(`SELECT * FROM ai_settings WHERE id = 1`)!;
    // Empty string for key clears it only if explicitly sent as ''? Treat '' as clear.
    const key = body.openrouter_key !== undefined ? (body.openrouter_key || null) : (cur.openrouter_key as string | null);
    run(
      `UPDATE ai_settings SET openrouter_key = ?, openrouter_model = ?, ollama_base_url = ?, ollama_model = ?, default_provider = ?, routing = ?, fallback_model = ?, redact_pii = ? WHERE id = 1`,
      key,
      body.openrouter_model ?? cur.openrouter_model,
      body.ollama_base_url ?? cur.ollama_base_url,
      body.ollama_model ?? cur.ollama_model,
      body.default_provider ?? cur.default_provider,
      // Store the canonical {provider, model} form; legacy string values
      // ("ollama"/"openrouter") are accepted by the schema and normalised here.
      body.routing !== undefined ? JSON.stringify(normalizeRoutingInput(body.routing ?? null)) : cur.routing,
      body.fallback_model !== undefined ? (body.fallback_model ?? null) : cur.fallback_model,
      body.redact_pii !== undefined && body.redact_pii !== null ? (body.redact_pii ? 1 : 0) : (cur.redact_pii ?? 0),
    );
    const row = get<Record<string, unknown>>(`SELECT * FROM ai_settings WHERE id = 1`)!;
    return NextResponse.json({ ai_settings: publicSettings(row) });
  } catch (e) { return handleError(e); }
}
