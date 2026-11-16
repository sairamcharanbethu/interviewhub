export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { all, run, newId, now } from '@/lib/db';
import { candidateSchema } from '@/lib/validation';
import { handleError, parseJsonBody } from '@/lib/errors';
import { serializeCandidate } from '@/lib/serialize';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const includeArchived = url.searchParams.get('include_archived') === 'true';
    const includeDeleted = url.searchParams.get('include_deleted') === 'true';
    let sql = `SELECT * FROM candidates WHERE 1=1`;
    const params: unknown[] = [];
    if (!includeDeleted) { sql += ` AND deleted_at IS NULL`; }
    if (!includeArchived) { sql += ` AND archived_at IS NULL`; }
    sql += ` ORDER BY is_default DESC, created_at DESC`;
    const rows = all<Record<string, unknown>>(sql, ...params);
    return NextResponse.json({ candidates: rows.map(serializeCandidate) });
  } catch (e) { return handleError(e); }
}

export async function POST(req: Request) {
  try {
    const body = await parseJsonBody(req, candidateSchema);
    const id = newId('cand_');
    const ts = now();
    run(
      `INSERT INTO candidates (id, name, email, phone, location, headline, summary, total_experience_years, skills, employment, education, certifications, projects, achievements, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, body.name, body.email ?? null, body.phone ?? null, body.location ?? null, body.headline ?? null, body.summary ?? null,
      body.total_experience_years ?? null, JSON.stringify(body.skills ?? []), JSON.stringify(body.employment ?? []),
      JSON.stringify(body.education ?? []), JSON.stringify(body.certifications ?? []), JSON.stringify(body.projects ?? []),
      JSON.stringify(body.achievements ?? []), body.notes ?? null, ts, ts,
    );
    const row = all<Record<string, unknown>>(`SELECT * FROM candidates WHERE id = ?`, id)[0];
    return NextResponse.json({ candidate: serializeCandidate(row) }, { status: 201 });
  } catch (e) { return handleError(e); }
}
