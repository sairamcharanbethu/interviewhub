export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { all, get, run, newId, now } from '@/lib/db';
import { applicationSchema } from '@/lib/validation';
import { handleError, parseJsonBody, notFound } from '@/lib/errors';
import { serializeApplication } from '@/lib/serialize';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const candidateId = url.searchParams.get('candidate_id');
    const status = url.searchParams.get('status');
    const includeArchived = url.searchParams.get('include_archived') === 'true';
    let sql = `SELECT * FROM applications WHERE deleted_at IS NULL`;
    const params: unknown[] = [];
    if (candidateId) { sql += ` AND candidate_id = ?`; params.push(candidateId); }
    if (status) { sql += ` AND status = ?`; params.push(status); }
    if (!includeArchived) sql += ` AND archived_at IS NULL`;
    sql += ` ORDER BY created_at DESC`;
    const rows = all<Record<string, unknown>>(sql, ...params);
    return NextResponse.json({ applications: rows.map(serializeApplication) });
  } catch (e) { return handleError(e); }
}

export async function POST(req: Request) {
  try {
    const body = await parseJsonBody(req, applicationSchema);
    const cand = get(`SELECT id FROM candidates WHERE id = ? AND deleted_at IS NULL`, body.candidate_id);
    if (!cand) throw notFound('Candidate not found');
    // Reject a selected resume that does not exist or belongs to another
    // candidate instead of storing a selection match/prep/Skill must refuse.
    const { validateSelectedResume } = await import('@/lib/context');
    validateSelectedResume(body.candidate_id, body.selected_resume_id ?? null);
    const id = newId('app_');
    const ts = now();
    run(
      `INSERT INTO applications (id, candidate_id, company, title, department, location, employment_type, job_url, recruiter, application_date, status, interview_date, stage, jd_text, jd_parsed, company_notes, notes, selected_resume_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, body.candidate_id, body.company, body.title, body.department ?? null, body.location ?? null,
      body.employment_type ?? null, body.job_url || null, JSON.stringify(body.recruiter ?? null),
      body.application_date ?? null, body.status ?? null, body.interview_date ?? null, body.stage ?? null,
      body.jd_text ?? null, JSON.stringify(body.jd_parsed ?? null), body.company_notes ?? null, body.notes ?? null,
      body.selected_resume_id ?? null, ts, ts,
    );
    const row = all<Record<string, unknown>>(`SELECT * FROM applications WHERE id = ?`, id)[0];
    return NextResponse.json({ application: serializeApplication(row) }, { status: 201 });
  } catch (e) { return handleError(e); }
}
