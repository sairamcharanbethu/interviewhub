export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get, run, newId, now } from '@/lib/db';
import { handleError, notFound } from '@/lib/errors';
import { serializeApplication } from '@/lib/serialize';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const row = get<Record<string, unknown>>(`SELECT * FROM applications WHERE id = ? AND deleted_at IS NULL`, params.id);
    if (!row) throw notFound('Application not found');
    const id = newId('app_'); const ts = now();
    run(
      `INSERT INTO applications (id, candidate_id, company, title, department, location, employment_type, job_url, recruiter, application_date, status, interview_date, stage, jd_text, jd_parsed, company_notes, notes, selected_resume_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, row.candidate_id, row.company, row.title, row.department, row.location, row.employment_type, row.job_url, row.recruiter, row.application_date, row.status, row.interview_date, row.stage, row.jd_text, row.jd_parsed, row.company_notes, row.notes, row.selected_resume_id, ts, ts,
    );
    const copy = get<Record<string, unknown>>(`SELECT * FROM applications WHERE id = ?`, id)!;
    return NextResponse.json({ application: serializeApplication(copy) }, { status: 201 });
  } catch (e) { return handleError(e); }
}
