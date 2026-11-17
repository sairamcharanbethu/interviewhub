export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { handleError, notFound } from '@/lib/errors';
import { retryJob } from '@/lib/prepare/job';
import { ensureWorker } from '@/lib/prepare/runner';

/**
 * POST /api/prepare/[jobId]/retry — re-runs only failed/fallback stages.
 * Increments retry_count. Never duplicates the candidate/application:
 * the runner reuses the job's stored candidate_id/application_id.
 */
export async function POST(_req: Request, { params }: { params: { jobId: string } }) {
  try {
    const job = retryJob(params.jobId);
    if (!job) throw notFound('Preparation job not found');
    ensureWorker();
    return NextResponse.json({ jobId: job.id, status: job.status, retryCount: job.retry_count });
  } catch (e) { return handleError(e); }
}
