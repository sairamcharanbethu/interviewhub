import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTempDir, jsonBody, jsonReq, makeTempDataDir } from '../helpers';
import { HARRIS_JD, NAGA_RESUME } from '../fixtures';

const dir = makeTempDataDir();
afterAll(() => cleanupTempDir(dir));

const { POST: createCandidate } = await import('@/app/api/candidates/route');
const { POST: uploadResume } = await import('@/app/api/candidates/[id]/resumes/route');
const { POST: createApplication } = await import('@/app/api/applications/route');
const { POST: pasteJd } = await import('@/app/api/applications/[id]/jd/route');
const { POST: prepQuestions } = await import('@/app/api/applications/[id]/prep/questions/route');
const { POST: generateDraft } = await import('@/app/api/star-stories/generate-draft/route');
const { POST: createStar } = await import('@/app/api/star-stories/route');

async function seed(): Promise<{ candidateId: string; applicationId: string }> {
  const c = await createCandidate(jsonReq('http://localhost/api/candidates', 'POST', { name: 'Naga Iswarya Lakshmi Bhogadi' }));
  const candidateId = ((await jsonBody(c)).candidate as Record<string, unknown>).id as string;
  const fd = new FormData();
  fd.append('file', new File([NAGA_RESUME], 'naga-resume.txt', { type: 'text/plain' }));
  await uploadResume(new Request(`http://localhost/api/candidates/${candidateId}/resumes`, { method: 'POST', body: fd }), { params: { id: candidateId } });
  const a = await createApplication(jsonReq('http://localhost/api/applications', 'POST', { candidate_id: candidateId, company: 'Harris Computer', title: 'Technical Consultant – Oracle DBA' }));
  const applicationId = ((await jsonBody(a)).application as Record<string, unknown>).id as string;
  await pasteJd(jsonReq(`http://localhost/api/applications/${applicationId}/jd`, 'POST', { jd_text: HARRIS_JD }), { params: { id: applicationId } });
  return { candidateId, applicationId };
}

describe('prep questions — offline fallback (no AI provider in tests)', () => {
  it('returns template questions with fallback=true when no provider is reachable', async () => {
    const { applicationId } = await seed();
    const res = await prepQuestions(new Request(`http://localhost/api/applications/${applicationId}/prep/questions`, { method: 'POST' }), { params: { id: applicationId } });
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.fallback).toBe(true);
    expect(body.source).toBe('template-offline-fallback');
    expect(body.ai_error as string).toMatch(/No AI provider configured|AI provider failed/);
    const qs = body.questions as Array<{ category: string; question: string; source: string }>;
    expect(qs.length).toBeGreaterThanOrEqual(12);
    expect(qs.some((q) => q.question.includes('Harris Computer'))).toBe(true);
    expect(qs.some((q) => q.question.includes('Oracle RAC'))).toBe(true);
  });

  it('returns 404 for an unknown application', async () => {
    const res = await prepQuestions(new Request('http://localhost/api/applications/nope/prep/questions', { method: 'POST' }), { params: { id: 'nope' } });
    expect(res.status).toBe(404);
  });
});

describe('STAR generate-draft — offline behaviour', () => {
  it('returns draft:null with verification_status draft when no AI is configured', async () => {
    const { candidateId } = await seed();
    const res = await generateDraft(jsonReq('http://localhost/api/star-stories/generate-draft', 'POST', { candidate_id: candidateId, role_hint: 'Oracle RAC failover' }));
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.draft).toBeNull();
    expect(body.verification_status).toBe('draft');
    expect(body.fallback).toBe(true);
    // No provider is reachable in tests. Ollama counts as "configured" by
    // URL (see lib/ai/providers.ts), so the failure surfaces as a provider
    // failure rather than "not configured" — either way the draft is null.
    expect(body.ai_error as string).toMatch(/No AI provider configured|AI provider failed/);
  });

  it('returns 404 for an unknown candidate', async () => {
    const res = await generateDraft(jsonReq('http://localhost/api/star-stories/generate-draft', 'POST', { candidate_id: 'nope' }));
    expect(res.status).toBe(404);
  });

  it('a manually created story defaults to draft, never verified', async () => {
    const { candidateId } = await seed();
    const res = await createStar(jsonReq('http://localhost/api/star-stories', 'POST', {
      candidate_id: candidateId, title: 'RAC failover during patching',
      situation: 'A node failed during patching.', action: 'Failed over with Data Guard.', result: 'Zero data loss.',
    }));
    expect(res.status).toBe(201);
    expect(((await jsonBody(res)).star_story as Record<string, unknown>).verification_status).toBe('draft');
  });
});
