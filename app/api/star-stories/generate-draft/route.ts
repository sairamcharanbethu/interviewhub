export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get } from '@/lib/db';
import { handleError, notFound, ApiError } from '@/lib/errors';
import { generateStarDraftAI } from '@/lib/prep';
import { retrieveContext } from '@/lib/rag';
import { getAiSettings } from '@/lib/ai/providers';

/**
 * POST /api/star-stories/generate-draft
 * Body: { candidate_id, prompt?: string, role_hint?: string }
 * Generates a STAR draft from the candidate's resume evidence only (RAG).
 * Returns the draft for user approval — it is NOT saved, and never saved
 * as verified. The user creates the story via POST /api/star-stories.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const candidateId = body.candidate_id as string | undefined;
    const roleHint = (body.role_hint as string) || (body.prompt as string) || '';
    if (!candidateId) throw new ApiError(400, 'candidate_id is required');
    const cand = get(`SELECT id FROM candidates WHERE id = ? AND deleted_at IS NULL`, candidateId);
    if (!cand) throw notFound('Candidate not found');
    const settings = getAiSettings();
    const { chunks, has_evidence, no_evidence_message } = retrieveContext({
      candidateId,
      query: roleHint || 'experience skills achievements projects',
      limit: 10,
      redactPii: settings.redact_pii,
    });
    if (!has_evidence) {
      return NextResponse.json({ draft: null, verification_status: 'draft', fallback: true, ai_error: no_evidence_message || 'No resume evidence found for this candidate — upload a resume first' }, { status: 200 });
    }
    const outcome = await generateStarDraftAI({ chunks, roleHint, redactPii: settings.redact_pii });
    if (!outcome.data) {
      return NextResponse.json({ draft: null, verification_status: 'draft', fallback: true, ai_error: outcome.ai_error ?? 'STAR draft generation failed' });
    }
    return NextResponse.json({
      draft: outcome.data,
      verification_status: 'draft',
      fallback: outcome.fallback,
      ai_error: outcome.ai_error ?? null,
      ai_usage: outcome.ai_usage ?? null,
    });
  } catch (e) { return handleError(e); }
}
