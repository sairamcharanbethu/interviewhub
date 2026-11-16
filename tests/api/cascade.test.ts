import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTempDir, jsonBody, jsonReq, makeTempDataDir } from '../helpers';
import { HARRIS_JD, NAGA_RESUME } from '../fixtures';

const dir = makeTempDataDir();
afterAll(() => cleanupTempDir(dir));

const { POST: createCandidate } = await import('@/app/api/candidates/route');
const { POST: uploadResume, GET: listResumes } = await import('@/app/api/candidates/[id]/resumes/route');
const { POST: createApplication } = await import('@/app/api/applications/route');
const { DELETE: deleteCandidate } = await import('@/app/api/candidates/[id]/route');
const { DELETE: deleteApplication } = await import('@/app/api/applications/[id]/route');
const { POST: createStar } = await import('@/app/api/star-stories/route');
const { POST: createSession } = await import('@/app/api/interview-sessions/route');
const { POST: generateSkill } = await import('@/app/api/natively/generate/route');
const { POST: pasteJd } = await import('@/app/api/applications/[id]/jd/route');
const dbLib = await import('@/lib/db');

function count(table: string, where: string, id: string): number {
  return (dbLib.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where} = ?`, id)?.n ?? -1);
}

async function seedFull(): Promise<{ candidateId: string; applicationId: string }> {
  const c = await createCandidate(jsonReq('http://localhost/api/candidates', 'POST', { name: 'Cascade Person' }));
  const candidateId = ((await jsonBody(c)).candidate as Record<string, unknown>).id as string;
  const fd = new FormData();
  fd.append('file', new File([NAGA_RESUME], 'r.txt', { type: 'text/plain' }));
  const up = await uploadResume(new Request(`http://localhost/api/candidates/${candidateId}/resumes`, { method: 'POST', body: fd }), { params: { id: candidateId } });
  // Assert the upload: a stale-FTS regression used to make this 500 after a
  // previous candidate's permanent delete (rowid reuse collision).
  expect(up.status).toBe(201);
  const a = await createApplication(jsonReq('http://localhost/api/applications', 'POST', { candidate_id: candidateId, company: 'Cascade Corp', title: 'DBA' }));
  const applicationId = ((await jsonBody(a)).application as Record<string, unknown>).id as string;
  await createStar(jsonReq('http://localhost/api/star-stories', 'POST', { candidate_id: candidateId, title: 'A story' }));
  await createSession(jsonReq('http://localhost/api/interview-sessions', 'POST', { application_id: applicationId, candidate_id: candidateId, title: 'Round 1' }));
  // Skill generation requires a JD (spec §4 step 4 / §8) — seed one.
  const jd = await pasteJd(jsonReq('http://localhost/api/applications', 'POST', { jd_text: HARRIS_JD }), { params: { id: applicationId } });
  expect(jd.status).toBe(200);
  const gen = await generateSkill(jsonReq('http://localhost/api/natively/generate', 'POST', { application_id: applicationId }));
  expect(gen.status).toBe(201);
  return { candidateId, applicationId };
}

describe('delete cascade', () => {
  it('permanent candidate delete removes resumes, applications, stories, sessions, chunks, skill syncs', async () => {
    const { candidateId, applicationId } = await seedFull();
    expect(count('resumes', 'candidate_id', candidateId)).toBe(1);
    expect(count('applications', 'candidate_id', candidateId)).toBe(1);
    expect(count('star_stories', 'candidate_id', candidateId)).toBe(1);
    expect(count('interview_sessions', 'candidate_id', candidateId)).toBe(1);
    expect(count('document_chunks', 'candidate_id', candidateId)).toBeGreaterThan(0);
    expect(count('skills_sync', 'application_id', applicationId)).toBe(1);

    const res = await deleteCandidate(new Request(`http://localhost/api/candidates/${candidateId}?permanent=true`, { method: 'DELETE' }), { params: { id: candidateId } });
    expect(res.status).toBe(200);
    expect((await jsonBody(res)).permanent).toBe(true);

    expect(count('resumes', 'candidate_id', candidateId)).toBe(0);
    expect(count('applications', 'candidate_id', candidateId)).toBe(0);
    expect(count('star_stories', 'candidate_id', candidateId)).toBe(0);
    expect(count('interview_sessions', 'candidate_id', candidateId)).toBe(0);
    expect(count('document_chunks', 'candidate_id', candidateId)).toBe(0);
    expect(count('skills_sync', 'application_id', applicationId)).toBe(0);
  });

  it('permanent application delete removes its sessions and skill syncs but keeps the resume', async () => {
    const { candidateId, applicationId } = await seedFull();
    const res = await deleteApplication(new Request(`http://localhost/api/applications/${applicationId}?permanent=true`, { method: 'DELETE' }), { params: { id: applicationId } });
    expect(res.status).toBe(200);
    expect(count('interview_sessions', 'application_id', applicationId)).toBe(0);
    expect(count('skills_sync', 'application_id', applicationId)).toBe(0);
    expect(count('applications', 'id', applicationId)).toBe(0);
    // Resume belongs to the candidate, not the application.
    expect(count('resumes', 'candidate_id', candidateId)).toBe(1);
    const list = await listResumes(new Request(`http://localhost/api/candidates/${candidateId}/resumes`), { params: { id: candidateId } });
    expect(((await jsonBody(list)).resumes as unknown[]).length).toBe(1);
  });
});
