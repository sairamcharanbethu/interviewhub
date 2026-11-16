export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { db, run } from '@/lib/db';
import { backupRestoreSchema } from '@/lib/validation';
import { handleError, ApiError } from '@/lib/errors';

const ALLOWED_TABLES = ['workspaces', 'candidates', 'resumes', 'applications', 'star_stories', 'interview_sessions', 'ai_settings', 'ai_usage', 'skills_sync', 'document_chunks'] as const;

/**
 * Columns of ai_settings that may be restored from a backup. The OpenRouter
 * key is deliberately excluded: exports strip it, and a hand-crafted backup
 * must never be able to smuggle a key in. Non-secret fields (models, URLs,
 * routing, redact_pii) restore normally.
 */
const AI_SETTINGS_RESTORE_COLUMNS = ['id', 'openrouter_model', 'ollama_base_url', 'ollama_model', 'default_provider', 'routing', 'fallback_model', 'redact_pii'] as const;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => { throw new ApiError(400, 'Invalid JSON body'); });
    const parsed = backupRestoreSchema.parse(body);
    const counts: Record<string, number> = {};
    const conn = db();
    const tx = conn.transaction(() => {
      for (const [table, rows] of Object.entries(parsed.tables)) {
        if (!(ALLOWED_TABLES as readonly string[]).includes(table)) throw new ApiError(400, `Table not allowed in restore: ${table}`);
        for (const row of rows) {
          // ai_settings: restore non-secret fields only; drop openrouter_key
          // and any other column outside the allow-list.
          const cols = table === 'ai_settings'
            ? Object.keys(row).filter((c) => (AI_SETTINGS_RESTORE_COLUMNS as readonly string[]).includes(c))
            : Object.keys(row);
          if (!cols.length) continue;
          const placeholders = cols.map(() => '?').join(', ');
          run(`INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`, ...cols.map((c) => {
            const v = row[c];
            return typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
          }));
        }
        counts[table] = rows.length;
      }
      // Rebuild FTS from document_chunks
      run(`DELETE FROM document_chunks_fts`);
      const chunks = conn.prepare(`SELECT rowid, chunk_text FROM document_chunks`).all() as Array<{ rowid: number; chunk_text: string }>;
      for (const c of chunks) run(`INSERT INTO document_chunks_fts (rowid, chunk_text) VALUES (?, ?)`, c.rowid, c.chunk_text);
    });
    tx();
    return NextResponse.json({ restored: true, counts });
  } catch (e) { return handleError(e); }
}
