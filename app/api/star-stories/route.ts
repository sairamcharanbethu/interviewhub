export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { all, get, run, newId, now } from '@/lib/db';
import { starStorySchema } from '@/lib/validation';
import { handleError, parseJsonBody, notFound, ApiError } from '@/lib/errors';
import { serializeStar } from '@/lib/serialize';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const candidateId = url.searchParams.get('candidate_id');
    if (!candidateId) throw new ApiError(400, 'candidate_id is required');
    const rows = all<Record<string, unknown>>(`SELECT * FROM star_stories WHERE candidate_id = ? AND archived_at IS NULL ORDER BY created_at DESC`, candidateId);
    return NextResponse.json({ star_stories: rows.map(serializeStar) });
  } catch (e) { return handleError(e); }
}

export async function POST(req: Request) {
  try {
    const body = await parseJsonBody(req, starStorySchema);
    const cand = get(`SELECT id FROM candidates WHERE id = ? AND deleted_at IS NULL`, body.candidate_id);
    if (!cand) throw notFound('Candidate not found');
    const id = newId('star_'); const ts = now();
    run(
      `INSERT INTO star_stories (id, candidate_id, title, situation, task, action, result, technologies, skills, employer, project, verification_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, body.candidate_id, body.title, body.situation ?? null, body.task ?? null, body.action ?? null, body.result ?? null,
      JSON.stringify(body.technologies ?? []), JSON.stringify(body.skills ?? []), body.employer ?? null, body.project ?? null,
      body.verification_status ?? 'draft', ts, ts,
    );
    const row = all<Record<string, unknown>>(`SELECT * FROM star_stories WHERE id = ?`, id)[0];
    return NextResponse.json({ star_story: serializeStar(row) }, { status: 201 });
  } catch (e) { return handleError(e); }
}
