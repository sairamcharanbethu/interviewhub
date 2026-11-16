export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get } from '@/lib/db';
import { handleError, ApiError } from '@/lib/errors';
import { listOpenRouterModels, listOllamaModels } from '@/lib/ai/providers';

/**
 * GET /api/ai-settings/models?provider=openrouter|ollama
 * Lists available models. The API key is never returned or logged.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const provider = (url.searchParams.get('provider') || 'ollama').toLowerCase();
    if (provider === 'openrouter') {
      try {
        const models = await listOpenRouterModels();
        return NextResponse.json({ provider, ok: true, models });
      } catch (e) {
        return NextResponse.json({ provider, ok: false, models: [], detail: e instanceof Error ? e.message : 'OpenRouter unreachable' });
      }
    }
    if (provider === 'ollama') {
      const row = get<Record<string, unknown>>(`SELECT ollama_base_url FROM ai_settings WHERE id = 1`);
      try {
        const models = await listOllamaModels((row?.ollama_base_url as string) || undefined);
        return NextResponse.json({ provider, ok: true, models });
      } catch (e) {
        return NextResponse.json({ provider, ok: false, models: [], detail: e instanceof Error ? e.message : 'Ollama unreachable' });
      }
    }
    throw new ApiError(400, 'provider must be openrouter or ollama');
  } catch (e) { return handleError(e); }
}
