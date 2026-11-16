export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get } from '@/lib/db';
import { handleError, notFound } from '@/lib/errors';
import { generateQuestionsAI } from '@/lib/prep';
import { retrieveContext } from '@/lib/rag';
import { getAiSettings } from '@/lib/ai/providers';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const app = get<Record<string, unknown>>(`SELECT * FROM applications WHERE id = ? AND deleted_at IS NULL`, params.id);
    if (!app) throw notFound('Application not found');
    const jdText = (app.jd_text as string) || '';
    const settings = getAiSettings();
    const { chunks } = retrieveContext({
      candidateId: app.candidate_id as string,
      applicationId: params.id,
      query: jdText.slice(0, 500) || 'experience skills',
      limit: 10,
      redactPii: settings.redact_pii,
    });
    const outcome = await generateQuestionsAI(jdText, (app.company as string) || '', { chunks, redactPii: settings.redact_pii });
    return NextResponse.json({
      application_id: params.id,
      source: outcome.fallback ? 'template-offline-fallback' : 'ai',
      fallback: outcome.fallback,
      ai_error: outcome.ai_error ?? null,
      ai_usage: outcome.ai_usage ?? null,
      questions: outcome.data,
    });
  } catch (e) { return handleError(e); }
}
