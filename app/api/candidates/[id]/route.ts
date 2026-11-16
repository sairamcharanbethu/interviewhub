export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get, run, now, transaction } from '@/lib/db';
import { candidatePatchSchema } from '@/lib/validation';
import { handleError, parseJsonBody, notFound, ApiError } from '@/lib/errors';
import { serializeCandidate } from '@/lib/serialize';

type Row = Record<string, unknown>;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const row = get<Row>(`SELECT * FROM candidates WHERE id = ? AND deleted_at IS NULL`, params.id);
    if (!row) throw notFound('Candidate not found');
    return NextResponse.json({ candidate: serializeCandidate(row) });
  } catch (e) { return handleError(e); }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await parseJsonBody(req, candidatePatchSchema);
    const row = get<Row>(`SELECT * FROM candidates WHERE id = ? AND deleted_at IS NULL`, params.id);
    if (!row) throw notFound('Candidate not found');
    const sets: string[] = [];
    const vals: unknown[] = [];
    const map: Record<string, unknown> = {
      name: body.name, email: body.email, phone: body.phone, location: body.location,
      headline: body.headline, summary: body.summary, total_experience_years: body.total_experience_years, notes: body.notes,
    };
    for (const [k, v] of Object.entries(map)) if (v !== undefined) { sets.push(`${k} = ?`); vals.push(v); }
    for (const k of ['skills', 'employment', 'education', 'certifications', 'projects', 'achievements'] as const) {
      if ((body as Record<string, unknown>)[k] !== undefined) { sets.push(`${k} = ?`); vals.push(JSON.stringify((body as Record<string, unknown>)[k] ?? [])); }
    }
    if (!sets.length) throw new ApiError(400, 'No fields to update');
    sets.push(`updated_at = ?`); vals.push(now());
    run(`UPDATE candidates SET ${sets.join(', ')} WHERE id = ?`, ...vals, params.id);
    const updated = get<Row>(`SELECT * FROM candidates WHERE id = ?`, params.id)!;
    return NextResponse.json({ candidate: serializeCandidate(updated) });
  } catch (e) { return handleError(e); }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const permanent = new URL(req.url).searchParams.get('permanent') === 'true';
    const row = get<Row>(`SELECT * FROM candidates WHERE id = ?`, params.id);
    if (!row) throw notFound('Candidate not found');
    if (permanent) {
      // Snapshot on-disk files BEFORE the DB delete: FK cascade removes the
      // rows these paths come from, and SQLite does not propagate deletes
      // into the standalone FTS5 table — purge orphaned FTS rows or later
      // chunk inserts can collide on a reused rowid and fail.
      const { candidateFilePaths, deleteCandidateFilesFromSnapshot } = await import('@/lib/cleanup');
      const { purgeOrphanFts } = await import('@/lib/rag');
      const filePaths = candidateFilePaths(params.id);
      transaction(() => { run(`DELETE FROM candidates WHERE id = ?`, params.id); purgeOrphanFts(); });
      const cleanup = deleteCandidateFilesFromSnapshot(params.id, filePaths);
      return NextResponse.json({
        deleted: true,
        permanent: true,
        files_removed: cleanup.removed.length,
        file_errors: cleanup.errors,
      });
    }
    run(`UPDATE candidates SET deleted_at = ?, updated_at = ? WHERE id = ?`, now(), now(), params.id);
    return NextResponse.json({ deleted: true, permanent: false });
  } catch (e) { return handleError(e); }
}
