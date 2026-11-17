export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { handleError, notFound } from '@/lib/errors';
import { getJob } from '@/lib/prepare/job';
import { STAGE_LABELS } from '@/lib/prepare/runner';

/** GET /api/prepare/[jobId] — job status, stage, progress, origins, install info. */
export async function GET(_req: Request, { params }: { params: { jobId: string } }) {
  try {
    const job = getJob(params.jobId);
    if (!job) throw notFound('Preparation job not found');
    const install = job.stage_results.installing_natively;
    const skill = job.stage_results.building_skill;
    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      currentStage: job.current_stage,
      currentStageLabel: job.current_stage ? STAGE_LABELS[job.current_stage] || job.current_stage : null,
      progress: job.progress,
      stageResults: job.stage_results,
      stageLabels: STAGE_LABELS,
      errorDetails: job.error_details,
      candidateId: job.candidate_id,
      applicationId: job.application_id,
      retryCount: job.retry_count,
      duplicateFlags: job.duplicate_flags,
      originSummary: job.origin_summary,
      install: install ? { status: install.status, detail: install.detail ?? null, error: install.error ?? null } : null,
      skill: skill ? { status: skill.status, detail: skill.detail ?? null, error: skill.error ?? null } : null,
      createdAt: job.created_at,
      completedAt: job.completed_at,
    });
  } catch (e) { return handleError(e); }
}
