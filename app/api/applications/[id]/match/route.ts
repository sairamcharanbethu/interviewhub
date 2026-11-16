export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get, parseJson } from '@/lib/db';
import { handleError, notFound, ApiError } from '@/lib/errors';
import { computeMatch, refineMatchWithAI } from '@/lib/match';
import { retrieveContext } from '@/lib/rag';
import { getAiSettings } from '@/lib/ai/providers';
import { resolveResumeForApplication } from '@/lib/context';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const app = get<Record<string, unknown>>(`SELECT * FROM applications WHERE id = ? AND deleted_at IS NULL`, params.id);
    if (!app) throw notFound('Application not found');
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    // Single shared resolver (lib/context.ts): selected resume wins, invalid
    // or cross-candidate selections fail with 400, active resume is the
    // fallback. Match, Prep, and Skill generation all use this path.
    const { resume } = resolveResumeForApplication(app, (body.resume_id as string) || null);
    if (!resume) throw new ApiError(400, 'No resume found for this candidate — upload a resume first');
    const candidate = get<Record<string, unknown>>(`SELECT * FROM candidates WHERE id = ?`, app.candidate_id);
    const parsed = parseJson<Record<string, unknown>>((resume.parsed as string) || null, {});
    // Attach candidate-level experience so the heuristic can use it.
    const parsedWithExp = { ...parsed, total_experience_years: candidate?.total_experience_years ?? null };
    const heuristic = computeMatch((resume.extracted_text as string) || '', parsedWithExp, (app.jd_text as string) || '', (app.jd_parsed as string) || null);
    // AI refinement: only when explicitly requested AND a provider is
    // configured. Otherwise the deterministic heuristic stands alone.
    if (body.ai_refine !== true) {
      return NextResponse.json({ application_id: params.id, resume_id: resume.id, ...heuristic, ai_refined: false });
    }
    const settings = getAiSettings();
    const jdText = (app.jd_text as string) || '';
    const query = heuristic.requirements.map((r) => r.requirement).join(' ').slice(0, 500) || jdText.slice(0, 500);
    const { chunks } = retrieveContext({
      candidateId: app.candidate_id as string,
      applicationId: params.id,
      resumeId: resume.id as string,
      query,
      limit: 12,
      redactPii: settings.redact_pii,
    });
    const refined = await refineMatchWithAI(heuristic, {
      resumeChunks: chunks,
      jdText,
      jdParsedRaw: (app.jd_parsed as string) || null,
      redactPii: settings.redact_pii,
    });
    return NextResponse.json({
      application_id: params.id,
      resume_id: resume.id,
      ...refined.result,
      ai_refined: refined.ai_refined,
      ai_usage: refined.ai_usage ?? null,
      ai_error: refined.ai_error ?? null,
    });
  } catch (e) { return handleError(e); }
}
