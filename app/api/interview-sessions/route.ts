export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { all, get, run, newId, now } from '@/lib/db';
import { sessionSchema } from '@/lib/validation';
import { handleError, parseJsonBody, notFound, ApiError } from '@/lib/errors';
import { serializeSession } from '@/lib/serialize';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const applicationId = url.searchParams.get('application_id');
    const candidateId = url.searchParams.get('candidate_id');
    if (!applicationId && !candidateId) throw new ApiError(400, 'application_id or candidate_id is required');
    let sql = `SELECT * FROM interview_sessions WHERE 1=1`;
    const params: unknown[] = [];
    if (applicationId) { sql += ` AND application_id = ?`; params.push(applicationId); }
    if (candidateId) { sql += ` AND candidate_id = ?`; params.push(candidateId); }
    sql += ` ORDER BY created_at DESC`;
    const rows = all<Record<string, unknown>>(sql, ...params);
    return NextResponse.json({ interview_sessions: rows.map(serializeSession) });
  } catch (e) { return handleError(e); }
}

export async function POST(req: Request) {
  try {
    const body = await parseJsonBody(req, sessionSchema);
    const app = get(`SELECT id FROM applications WHERE id = ? AND deleted_at IS NULL`, body.application_id);
    if (!app) throw notFound('Application not found');
    const id = newId('sess_'); const ts = now();
    run(
      `INSERT INTO interview_sessions (id, application_id, candidate_id, title, questions, answers, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, body.application_id, body.candidate_id, body.title ?? null, JSON.stringify(body.questions ?? []), JSON.stringify(body.answers ?? []), body.notes ?? null, ts, ts,
    );
    const row = all<Record<string, unknown>>(`SELECT * FROM interview_sessions WHERE id = ?`, id)[0];
    return NextResponse.json({ interview_session: serializeSession(row) }, { status: 201 });
  } catch (e) { return handleError(e); }
}
