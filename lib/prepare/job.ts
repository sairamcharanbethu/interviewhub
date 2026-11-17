// Preparation job store (migration 004). Idempotency: idempotency_key =
// 'prepare:' + sha256(resume bytes + JD text + candidate email?). A retry
// reuses the job's candidate_id/application_id — it never creates a second
// candidate or application.
import crypto from 'crypto';
import { get, all, run, newId, now, parseJson } from '../db';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'partial';
export type StageResult = { status: 'completed' | 'failed' | 'skipped'; origin?: 'ai' | 'fallback'; error?: string; detail?: Record<string, unknown> };
export interface PrepJob {
  id: string;
  candidate_id: string | null;
  application_id: string | null;
  status: JobStatus;
  current_stage: string | null;
  progress: number;
  stage_results: Record<string, StageResult>;
  error_details: Record<string, unknown> | null;
  retry_count: number;
  idempotency_key: string | null;
  duplicate_flags: Record<string, unknown> | null;
  origin_summary: Record<string, string> | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  claimed_at: string | null;
  claimed_by: string | null;
}

export function idempotencyKeyFor(resumeBytes: Buffer, jdText: string, email?: string | null): string {
  const h = crypto.createHash('sha256');
  h.update(resumeBytes);
  h.update('\0');
  h.update(jdText);
  h.update('\0');
  h.update((email || '').toLowerCase().trim());
  return `prepare:${h.digest('hex')}`;
}

function rowToJob(r: Record<string, unknown>): PrepJob {
  return {
    id: String(r.id),
    candidate_id: (r.candidate_id as string) || null,
    application_id: (r.application_id as string) || null,
    status: r.status as JobStatus,
    current_stage: (r.current_stage as string) || null,
    progress: Number(r.progress ?? 0),
    stage_results: parseJson<Record<string, StageResult>>((r.stage_results as string) || null, {}),
    error_details: parseJson<Record<string, unknown> | null>((r.error_details as string) || null, null),
    retry_count: Number(r.retry_count ?? 0),
    idempotency_key: (r.idempotency_key as string) || null,
    duplicate_flags: parseJson<Record<string, unknown> | null>((r.duplicate_flags as string) || null, null),
    origin_summary: parseJson<Record<string, string> | null>((r.origin_summary as string) || null, null),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    completed_at: (r.completed_at as string) || null,
    claimed_at: (r.claimed_at as string) || null,
    claimed_by: (r.claimed_by as string) || null,
  };
}

export function getJobByIdempotencyKey(key: string): PrepJob | null {
  const r = get<Record<string, unknown>>(`SELECT * FROM preparation_jobs WHERE idempotency_key = ?`, key);
  return r ? rowToJob(r) : null;
}

export function createJob(idempotencyKey: string): PrepJob {
  const existing = get<Record<string, unknown>>(`SELECT * FROM preparation_jobs WHERE idempotency_key = ?`, idempotencyKey);
  if (existing) return rowToJob(existing);
  const id = newId('job_');
  const ts = now();
  run(
    `INSERT INTO preparation_jobs (id, status, current_stage, progress, stage_results, retry_count, idempotency_key, created_at, updated_at) VALUES (?, 'queued', 'reading_resume', 0, '{}', 0, ?, ?, ?)`,
    id, idempotencyKey, ts, ts,
  );
  return rowToJob(get<Record<string, unknown>>(`SELECT * FROM preparation_jobs WHERE id = ?`, id)!);
}

export function getJob(id: string): PrepJob | null {
  const r = get<Record<string, unknown>>(`SELECT * FROM preparation_jobs WHERE id = ?`, id);
  return r ? rowToJob(r) : null;
}

export function listJobs(limit = 20): PrepJob[] {
  return all<Record<string, unknown>>(`SELECT * FROM preparation_jobs ORDER BY created_at DESC LIMIT ?`, limit).map(rowToJob);
}

/** Atomic claim: queued, or running-but-stale (claimed >10 min ago). Returns the claimed job or null. */
export function claimNextJob(workerId: string): PrepJob | null {
  const staleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const ts = now();
  const res = run(
    `UPDATE preparation_jobs SET status = 'running', claimed_at = ?, claimed_by = ?, updated_at = ? WHERE id = (SELECT id FROM preparation_jobs WHERE status = 'queued' OR (status = 'running' AND (claimed_at IS NULL OR claimed_at < ?)) ORDER BY created_at ASC LIMIT 1)`,
    ts, workerId, ts, staleCutoff,
  );
  if (res.changes === 0) return null;
  const r = get<Record<string, unknown>>(`SELECT * FROM preparation_jobs WHERE claimed_by = ? AND claimed_at = ? ORDER BY created_at ASC LIMIT 1`, workerId, ts);
  return r ? rowToJob(r) : null;
}

export function updateJob(id: string, patch: Partial<Pick<PrepJob, 'candidate_id' | 'application_id' | 'status' | 'current_stage' | 'progress' | 'error_details' | 'duplicate_flags' | 'origin_summary' | 'completed_at'>>): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  const map: Record<string, string> = {
    candidate_id: 'candidate_id', application_id: 'application_id', status: 'status',
    current_stage: 'current_stage', progress: 'progress', completed_at: 'completed_at',
  };
  for (const [k, col] of Object.entries(map)) {
    if (patch[k as keyof typeof patch] !== undefined) { sets.push(`${col} = ?`); params.push(patch[k as keyof typeof patch] ?? null); }
  }
  if (patch.error_details !== undefined) { sets.push('error_details = ?'); params.push(patch.error_details ? JSON.stringify(patch.error_details) : null); }
  if (patch.duplicate_flags !== undefined) { sets.push('duplicate_flags = ?'); params.push(patch.duplicate_flags ? JSON.stringify(patch.duplicate_flags) : null); }
  if (patch.origin_summary !== undefined) { sets.push('origin_summary = ?'); params.push(patch.origin_summary ? JSON.stringify(patch.origin_summary) : null); }
  sets.push('updated_at = ?');
  params.push(now());
  run(`UPDATE preparation_jobs SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
}

export function updateStage(jobId: string, stage: string, result: StageResult): void {
  const job = getJob(jobId);
  if (!job) return;
  const results = { ...job.stage_results, [stage]: result };
  run(`UPDATE preparation_jobs SET stage_results = ?, updated_at = ? WHERE id = ?`, JSON.stringify(results), now(), jobId);
}

export function completeJob(id: string, status: 'completed' | 'partial', errorDetails?: Record<string, unknown>): void {
  updateJob(id, { status, progress: 100, current_stage: 'ready', completed_at: now(), ...(errorDetails ? { error_details: errorDetails } : {}) });
}

export function failJob(id: string, errorDetails: Record<string, unknown>): void {
  updateJob(id, { status: 'failed', current_stage: null, completed_at: now(), error_details: errorDetails });
}

export function retryJob(id: string): PrepJob | null {
  const job = getJob(id);
  if (!job) return null;
  if (job.status !== 'failed' && job.status !== 'partial' && job.status !== 'completed') return job;
  // Keep completed stages in stage_results (idempotent skip on re-run);
  // reset only failed/fallback stages so retry re-runs those.
  const results = { ...job.stage_results };
  for (const [stage, r] of Object.entries(results)) {
    if (r.status === 'failed' || r.origin === 'fallback') delete results[stage];
  }
  run(
    `UPDATE preparation_jobs SET status = 'queued', stage_results = ?, retry_count = retry_count + 1, claimed_at = NULL, claimed_by = NULL, completed_at = NULL, updated_at = ? WHERE id = ?`,
    JSON.stringify(results), now(), id,
  );
  return getJob(id);
}
