export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { all, get } from '@/lib/db';
import { handleError, notFound, ApiError } from '@/lib/errors';
import { draftAnswersAI } from '@/lib/prep';
import { retrieveContext } from '@/lib/rag';
import { getAiSettings } from '@/lib/ai/providers';
import { resolveResumeForApplication } from '@/lib/context';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const app = get<Record<string, unknown>>(`SELECT * FROM applications WHERE id = ? AND deleted_at IS NULL`, params.id);
    if (!app) throw notFound('Application not found');
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const questions = body.questions as Array<{ question: string; category?: string }> | undefined;
    if (!Array.isArray(questions) || !questions.length) throw new ApiError(400, 'Provide questions: [{question, category}]');
    const stories = all<Record<string, unknown>>(`SELECT * FROM star_stories WHERE candidate_id = ? AND archived_at IS NULL ORDER BY created_at DESC`, app.candidate_id);
    const settings = getAiSettings();
    const query = questions.map((q) => q.question).join(' ').slice(0, 500) || 'experience skills';
    const { resume } = resolveResumeForApplication(app);
    const { chunks } = retrieveContext({
      candidateId: app.candidate_id as string,
      applicationId: params.id,
      resumeId: resume ? (resume.id as string) : null,
      query,
      limit: 10,
      redactPii: settings.redact_pii,
    });
    const outcome = await draftAnswersAI(questions, { chunks, starStories: stories, redactPii: settings.redact_pii });
    return NextResponse.json({
      application_id: params.id,
      source: outcome.fallback ? 'template-offline-fallback' : 'ai',
      fallback: outcome.fallback,
      ai_error: outcome.ai_error ?? null,
      ai_usage: outcome.ai_usage ?? null,
      answers: outcome.data.map((a) => ({ ...a, source: outcome.fallback ? 'template-offline-fallback' : 'ai' })),
    });
  } catch (e) { return handleError(e); }
}
