export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get, run, now, transaction } from '@/lib/db';
import { applicationPatchSchema } from '@/lib/validation';
import { handleError, parseJsonBody, notFound, ApiError } from '@/lib/errors';
import { serializeApplication } from '@/lib/serialize';

type Row = Record<string, unknown>;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const row = get<Row>(`SELECT * FROM applications WHERE id = ? AND deleted_at IS NULL`, params.id);
    if (!row) throw notFound('Application not found');
    return NextResponse.json({ application: serializeApplication(row) });
  } catch (e) { return handleError(e); }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await parseJsonBody(req, applicationPatchSchema);
    const row = get<Row>(`SELECT * FROM applications WHERE id = ? AND deleted_at IS NULL`, params.id);
    if (!row) throw notFound('Application not found');
    const sets: string[] = []; const vals: unknown[] = [];
    for (const k of ['company','title','department','location','employment_type','job_url','application_date','status','interview_date','stage','jd_text','company_notes','notes','selected_resume_id'] as const) {
      if ((body as Record<string, unknown>)[k] !== undefined) { sets.push(`${k} = ?`); vals.push((body as Record<string, unknown>)[k] ?? null); }
    }
    if (body.recruiter !== undefined) { sets.push(`recruiter = ?`); vals.push(JSON.stringify(body.recruiter ?? null)); }
    if (body.jd_parsed !== undefined) { sets.push(`jd_parsed = ?`); vals.push(JSON.stringify(body.jd_parsed ?? null)); }
    if (!sets.length) throw new ApiError(400, 'No fields to update');
    sets.push(`updated_at = ?`); vals.push(now());
    run(`UPDATE applications SET ${sets.join(', ')} WHERE id = ?`, ...vals, params.id);
    const u = get<Row>(`SELECT * FROM applications WHERE id = ?`, params.id)!;
    return NextResponse.json({ application: serializeApplication(u) });
  } catch (e) { return handleError(e); }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const permanent = new URL(req.url).searchParams.get('permanent') === 'true';
    const row = get<Row>(`SELECT * FROM applications WHERE id = ?`, params.id);
    if (!row) throw notFound('Application not found');
    if (permanent) {
      // Snapshot this application's Skill files BEFORE the DB delete (FK
      // cascade removes the skills_sync rows they come from). Candidate
      // resumes and other applications are untouched. FTS5 orphans are
      // purged the same way as for candidates (see lib/rag.ts).
      const { applicationSkillPaths, deleteApplicationFilesFromSnapshot } = await import('@/lib/cleanup');
      const { purgeOrphanFts } = await import('@/lib/rag');
      const skillPaths = applicationSkillPaths(params.id);
      transaction(() => { run(`DELETE FROM applications WHERE id = ?`, params.id); purgeOrphanFts(); });
      const cleanup = deleteApplicationFilesFromSnapshot(skillPaths);
      return NextResponse.json({
        deleted: true,
        permanent: true,
        skill_files_removed: cleanup.removed.length,
        file_errors: cleanup.errors,
      });
    }
    run(`UPDATE applications SET deleted_at = ?, updated_at = ? WHERE id = ?`, now(), now(), params.id);
    return NextResponse.json({ deleted: true, permanent: false });
  } catch (e) { return handleError(e); }
}
