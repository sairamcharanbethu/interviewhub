export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { handleError, ApiError } from '@/lib/errors';
import { dataDir } from '@/lib/db';
import { validateUploadBytes } from '@/lib/security';
import { createJob, getJobByIdempotencyKey, idempotencyKeyFor } from '@/lib/prepare/job';
import { savePrepareInputs, ensureWorker, STAGE_LABELS } from '@/lib/prepare/runner';
import { fetchUrlText } from '@/lib/parse/fetch-url';
import { extractTextByMime } from '@/lib/parse/resume';

/**
 * POST /api/prepare — one-click Prepare Interview.
 * multipart/form-data: resume (PDF/DOCX/TXT/MD, magic-byte validated) +
 * jd_text OR jd_url OR jd_file. Creates a background preparation job and
 * returns { jobId, status: 'queued' } immediately; progress is polled via
 * GET /api/prepare/[jobId]. Idempotent on (resume bytes + JD text).
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData().catch(() => null);
    if (!form) throw new ApiError(400, 'Expected multipart form data with a resume file and a job description');
    const resumeFile = form.get('resume');
    if (!(resumeFile instanceof File)) throw new ApiError(400, 'A resume file (PDF, DOCX, TXT, or MD) is required');
    const resumeBytes = Buffer.from(await resumeFile.arrayBuffer());
    const v = validateUploadBytes(resumeFile.name, resumeBytes, resumeFile.type);
    if (!v.ok) throw new ApiError(400, v.error);

    const jdTextRaw = String(form.get('jd_text') || '').trim();
    const jdUrl = String(form.get('jd_url') || '').trim() || null;
    const jdFile = form.get('jd_file');
    let jdText = jdTextRaw;
    let jdFileStoredPath: string | null = null;
    let jdFilename: string | null = null;
    if (!jdText && jdFile instanceof File && jdFile.size > 0) {
      const jdBytes = Buffer.from(await jdFile.arrayBuffer());
      const jv = validateUploadBytes(jdFile.name, jdBytes, jdFile.type);
      if (!jv.ok) throw new ApiError(400, `JD file: ${jv.error}`);
      jdText = await extractTextByMime(jdBytes, jdFile.type, jdFile.name);
      jdFilename = jdFile.name;
    }
    if (!jdText && !jdUrl) throw new ApiError(400, 'Provide the job description as pasted text, a URL, or an uploaded file');
    if (jdUrl && !jdText) {
      // Validate the URL early so a bad URL fails fast instead of failing the job later.
      try { await fetchUrlText(jdUrl); } catch (e) { throw e; }
    }

    const key = idempotencyKeyFor(resumeBytes, jdText || jdUrl || '');
    const existing = getJobByIdempotencyKey(key);
    if (existing && (existing.status === 'queued' || existing.status === 'running' || existing.status === 'completed' || existing.status === 'partial')) {
      // Idempotent re-submit: return the existing job, do not duplicate work.
      ensureWorker();
      return NextResponse.json({ jobId: existing.id, status: existing.status, idempotent: true }, { status: 202 });
    }
    const job = existing ?? createJob(key);
    // Re-run a failed job with fresh inputs.
    const dir = path.join(dataDir(), 'prepare-inputs');
    fs.mkdirSync(dir, { recursive: true });
    const resumeStoredPath = path.join('prepare-inputs', `${job.id}-resume`);
    fs.writeFileSync(path.join(dataDir(), resumeStoredPath), resumeBytes);
    if (jdFile instanceof File && jdFile.size > 0) {
      jdFileStoredPath = path.join('prepare-inputs', `${job.id}-jd`);
      fs.writeFileSync(path.join(dataDir(), jdFileStoredPath), Buffer.from(await jdFile.arrayBuffer()));
    }
    savePrepareInputs(job.id, {
      resumeFilename: resumeFile.name,
      resumeMime: resumeFile.type || '',
      resumeStoredPath,
      jdText: jdText || null,
      jdUrl,
      jdFilename,
      jdFileStoredPath,
    });
    // Reset a previously failed job to queued for the fresh run.
    const { run, now } = await import('@/lib/db');
    run(`UPDATE preparation_jobs SET status = 'queued', current_stage = 'reading_resume', progress = 0, stage_results = '{}', error_details = NULL, completed_at = NULL, claimed_at = NULL, claimed_by = NULL, updated_at = ? WHERE id = ?`, now(), job.id);
    ensureWorker();
    return NextResponse.json({ jobId: job.id, status: 'queued', stages: STAGE_LABELS }, { status: 202 });
  } catch (e) { return handleError(e); }
}
