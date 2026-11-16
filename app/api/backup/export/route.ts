export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { all } from '@/lib/db';
import { handleError } from '@/lib/errors';

const TABLES = ['workspaces', 'candidates', 'resumes', 'applications', 'star_stories', 'interview_sessions', 'ai_settings', 'ai_usage', 'skills_sync', 'document_chunks'];

export async function POST() {
  try {
    const tables: Record<string, unknown[]> = {};
    for (const t of TABLES) {
      // ai_settings excluded from secret leak: strip openrouter_key
      if (t === 'ai_settings') {
        tables[t] = all<Record<string, unknown>>(`SELECT id, openrouter_model, ollama_base_url, ollama_model, default_provider, routing, fallback_model, redact_pii FROM ai_settings`);
      } else if (t === 'candidates' || t === 'applications') {
        tables[t] = all(`SELECT * FROM ${t} WHERE deleted_at IS NULL`);
      } else {
        tables[t] = all(`SELECT * FROM ${t}`);
      }
    }
    return NextResponse.json({ version: 1, exported_at: new Date().toISOString(), tables });
  } catch (e) { return handleError(e); }
}
