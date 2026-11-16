export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { all } from '@/lib/db';
import { handleError, ApiError } from '@/lib/errors';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get('q') || '').trim();
    let candidateId = url.searchParams.get('candidate_id');
    const applicationId = url.searchParams.get('application_id');
    if (!q) throw new ApiError(400, 'Query parameter q is required');
    if (!candidateId && applicationId) {
      const app = (await import('@/lib/db')).get<Record<string, unknown>>(`SELECT candidate_id FROM applications WHERE id = ?`, applicationId);
      candidateId = (app?.candidate_id as string) || null;
    }
    if (!candidateId) throw new ApiError(400, 'Scope the search with candidate_id (and optionally application_id) — never cross-candidate');
    // FTS5 scoped by candidate_id; never cross-candidate. The query is
    // tokenized/quoted via ftsQueryFromText — raw user input in MATCH would
    // throw an FTS5 syntax error on terms like "quokka-rac-failover".
    const { ftsQueryFromText } = await import('@/lib/rag');
    const ftsQuery = ftsQueryFromText(q);
    const rows = ftsQuery ? all<Record<string, unknown>>(
      `SELECT c.id, c.resume_id, c.application_id, c.candidate_id, c.chunk_text, c.chunk_index
       FROM document_chunks_fts f
       JOIN document_chunks c ON c.rowid = f.rowid
       WHERE f.chunk_text MATCH ? AND c.candidate_id = ?
       ${applicationId ? 'AND c.application_id = ?' : ''}
       LIMIT 50`,
      ftsQuery, candidateId as string, ...(applicationId ? [applicationId] : []),
    ) : [];
    // Fallback to LIKE if FTS syntax yields nothing (e.g. special chars) — still scoped.
    const results = rows.length ? rows : all<Record<string, unknown>>(
      `SELECT id, resume_id, application_id, candidate_id, chunk_text, chunk_index FROM document_chunks WHERE candidate_id = ? AND chunk_text LIKE ? LIMIT 50`,
      candidateId as string, `%${q}%`,
    );
    return NextResponse.json({ query: q, candidate_id: candidateId, application_id: applicationId, chunks: results.map((r) => ({ id: r.id, resume_id: r.resume_id, application_id: r.application_id, candidate_id: r.candidate_id, chunk_index: r.chunk_index, chunk_text: r.chunk_text })) });
  } catch (e) { return handleError(e); }
}
