export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { db, get } from '@/lib/db';
import { getAiSettings } from '@/lib/ai/providers';

export async function GET() {
  let dbOk = false;
  try { db().prepare('SELECT 1').get(); dbOk = true; } catch { dbOk = false; }
  const settings = getAiSettings();
  let ollamaReachable = false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    try {
      const res = await fetch(`${settings.ollama_base_url.replace(/\/$/, '')}/api/tags`, { signal: ctrl.signal });
      ollamaReachable = res.ok;
    } finally { clearTimeout(t); }
  } catch { ollamaReachable = false; }
  const openrouterConfigured = Boolean(settings.openrouter_key);
  return NextResponse.json({ status: dbOk ? 'ok' : 'degraded', db: dbOk ? 'ok' : 'error', ollama_reachable: ollamaReachable, openrouter_configured: openrouterConfigured, timestamp: new Date().toISOString() });
}
