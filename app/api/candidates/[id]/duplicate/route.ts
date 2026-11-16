export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get, run, newId, now } from '@/lib/db';
import { handleError, notFound } from '@/lib/errors';
import { serializeCandidate } from '@/lib/serialize';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const row = get<Record<string, unknown>>(`SELECT * FROM candidates WHERE id = ? AND deleted_at IS NULL`, params.id);
    if (!row) throw notFound('Candidate not found');
    const id = newId('cand_');
    const ts = now();
    run(
      `INSERT INTO candidates (id, name, email, phone, location, headline, summary, total_experience_years, skills, employment, education, certifications, projects, achievements, notes, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      id, `${row.name} (copy)`, row.email, row.phone, row.location, row.headline, row.summary, row.total_experience_years,
      row.skills, row.employment, row.education, row.certifications, row.projects, row.achievements, row.notes, ts, ts,
    );
    const copy = get<Record<string, unknown>>(`SELECT * FROM candidates WHERE id = ?`, id)!;
    return NextResponse.json({ candidate: serializeCandidate(copy) }, { status: 201 });
  } catch (e) { return handleError(e); }
}
