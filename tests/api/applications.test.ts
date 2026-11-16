import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTempDir, jsonBody, jsonReq, makeTempDataDir } from '../helpers';
import { HARRIS_JD, NAGA_RESUME } from '../fixtures';

const dir = makeTempDataDir();
afterAll(() => cleanupTempDir(dir));

const { POST: createCandidate } = await import('@/app/api/candidates/route');
const { POST: uploadResume, GET: listResumes } = await import('@/app/api/candidates/[id]/resumes/route');
const { POST: createApplication } = await import('@/app/api/applications/route');
const { GET: getApplication, PATCH: patchApplication, DELETE: deleteApplication } = await import('@/app/api/applications/[id]/route');
const { POST: pasteJd } = await import('@/app/api/applications/[id]/jd/route');
const { POST: runMatch } = await import('@/app/api/applications/[id]/match/route');
const { POST: archiveApplication } = await import('@/app/api/applications/[id]/archive/route');
const { POST: restoreApplication } = await import('@/app/api/applications/[id]/restore/route');
const { POST: duplicateApplication } = await import('@/app/api/applications/[id]/duplicate/route');

async function seed(): Promise<{ candidateId: string; applicationId: string }> {
  const c = await createCandidate(jsonReq('http://localhost/api/candidates', 'POST', { name: 'Naga Iswarya Lakshmi Bhogadi', total_experience_years: 4 }));
  const candidateId = ((await jsonBody(c)).candidate as Record<string, unknown>).id as string;
  const fd = new FormData();
  fd.append('file', new File([NAGA_RESUME], 'naga-resume.txt', { type: 'text/plain' }));
  const up = await uploadResume(new Request(`http://localhost/api/candidates/${candidateId}/resumes`, { method: 'POST', body: fd }), { params: { id: candidateId } });
  expect(up.status).toBe(201);
  const a = await createApplication(jsonReq('http://localhost/api/applications', 'POST', {
    candidate_id: candidateId, company: 'Harris Computer', title: 'Technical Consultant – Oracle DBA', location: 'Remote',
  }));
  expect(a.status).toBe(201);
  const applicationId = ((await jsonBody(a)).application as Record<string, unknown>).id as string;
  return { candidateId, applicationId };
}

describe('application CRUD + JD + match', () => {
  it('creates an application, pastes a JD, and runs the match', async () => {
    const { candidateId, applicationId } = await seed();
    const jd = await pasteJd(jsonReq(`http://localhost/api/applications/${applicationId}/jd`, 'POST', { jd_text: HARRIS_JD }), { params: { id: applicationId } });
    expect(jd.status).toBe(200);
    const jdBody = await jsonBody(jd);
    const parsed = (jdBody.jd_parsed as Record<string, unknown>);
    expect(parsed.required_skills as string[]).toEqual(expect.arrayContaining(['Oracle RAC', 'RMAN']));
    expect(parsed.experience_years).toBe(3);

    const m = await runMatch(jsonReq(`http://localhost/api/applications/${applicationId}/match`, 'POST', {}), { params: { id: applicationId } });
    expect(m.status).toBe(200);
    const match = await jsonBody(m);
    expect(match.application_id).toBe(applicationId);
    expect(match.score as number).toBeGreaterThanOrEqual(60);
    expect(match.ai_refined).toBe(false);
    const reqs = match.requirements as Array<{ requirement: string; demonstrated: boolean; evidence: string }>;
    expect(reqs.length).toBeGreaterThan(0);
    // A demonstrated skill carries evidence; a missing cert says so plainly.
    const rac = reqs.find((r) => r.requirement === 'Oracle RAC');
    expect(rac?.demonstrated).toBe(true);
    expect(rac?.evidence).not.toBe('Not demonstrated');
    const cert = reqs.find((r) => r.requirement.includes('Certification'));
    if (cert) expect(cert.demonstrated).toBe(false);
    expect(cert?.evidence).toBe('Not demonstrated');

    // PATCH updates status.
    const patched = await patchApplication(jsonReq(`http://localhost/api/applications/${applicationId}`, 'PATCH', { status: 'Applied' }), { params: { id: applicationId } });
    expect(((await jsonBody(patched)).application as Record<string, unknown>).status).toBe('Applied');
    expect(candidateId).toBeTruthy();
  });

  it('match fails cleanly with no resume on file', async () => {
    const c = await createCandidate(jsonReq('http://localhost/api/candidates', 'POST', { name: 'No Resume Person' }));
    const candidateId = ((await jsonBody(c)).candidate as Record<string, unknown>).id as string;
    const a = await createApplication(jsonReq('http://localhost/api/applications', 'POST', { candidate_id: candidateId, company: 'Acme', title: 'DBA' }));
    const applicationId = ((await jsonBody(a)).application as Record<string, unknown>).id as string;
    const m = await runMatch(jsonReq(`http://localhost/api/applications/${applicationId}/match`, 'POST', {}), { params: { id: applicationId } });
    expect(m.status).toBe(400);
  });

  it('rejects an empty JD paste', async () => {
    const { applicationId } = await seed();
    const res = await pasteJd(jsonReq(`http://localhost/api/applications/${applicationId}/jd`, 'POST', { jd_text: '   ' }), { params: { id: applicationId } });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown application id', async () => {
    const res = await getApplication(new Request('http://localhost/api/applications/nope'), { params: { id: 'nope' } });
    expect(res.status).toBe(404);
  });

  it('archives and restores an application', async () => {
    const { applicationId } = await seed();
    const archived = await archiveApplication(new Request('http://localhost/api/applications/x/archive', { method: 'POST' }), { params: { id: applicationId } });
    expect(archived.status).toBe(200);
    expect(((await jsonBody(archived)).application as Record<string, unknown>).archived_at).toBeTruthy();
    const restored = await restoreApplication(new Request('http://localhost/api/applications/x/restore', { method: 'POST' }), { params: { id: applicationId } });
    expect(restored.status).toBe(200);
    expect(((await jsonBody(restored)).application as Record<string, unknown>).archived_at).toBeNull();
  });

  it('duplicates an application', async () => {
    const { applicationId } = await seed();
    const dup = await duplicateApplication(new Request('http://localhost/api/applications/x/duplicate', { method: 'POST' }), { params: { id: applicationId } });
    expect(dup.status).toBe(201);
    const copy = (await jsonBody(dup)).application as Record<string, unknown>;
    expect(copy.id).not.toBe(applicationId);
    expect(copy.company).toBe('Harris Computer');
  });

  it('deleting an application (soft or permanent) leaves the resume in place', async () => {
    const { candidateId, applicationId } = await seed();
    const del = await deleteApplication(new Request(`http://localhost/api/applications/${applicationId}`, { method: 'DELETE' }), { params: { id: applicationId } });
    expect(del.status).toBe(200);
    const resumes = await listResumes(new Request(`http://localhost/api/candidates/${candidateId}/resumes`), { params: { id: candidateId } });
    expect(((await jsonBody(resumes)).resumes as unknown[]).length).toBe(1);

    const { applicationId: app2 } = await seed();
    const perm = await deleteApplication(new Request(`http://localhost/api/applications/${app2}?permanent=true`, { method: 'DELETE' }), { params: { id: app2 } });
    expect(perm.status).toBe(200);
    expect((await jsonBody(perm)).permanent).toBe(true);
    const gone = await getApplication(new Request(`http://localhost/api/applications/${app2}`), { params: { id: app2 } });
    expect(gone.status).toBe(404);
  });
});
