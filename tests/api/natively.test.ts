import fs from 'fs';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTempDir, jsonBody, jsonReq, makeTempDataDir } from '../helpers';
import { HARRIS_JD, NAGA_RESUME } from '../fixtures';

const dir = makeTempDataDir();
afterAll(() => cleanupTempDir(dir));

const { POST: createCandidate } = await import('@/app/api/candidates/route');
const { POST: uploadResume } = await import('@/app/api/candidates/[id]/resumes/route');
const { POST: createApplication } = await import('@/app/api/applications/route');
const { POST: pasteJd } = await import('@/app/api/applications/[id]/jd/route');
const { POST: createStar } = await import('@/app/api/star-stories/route');
const { POST: generateSkill } = await import('@/app/api/natively/generate/route');

describe('natively generate', () => {
  it('writes a SKILL.md containing candidate, company, and role', async () => {
    const c = await createCandidate(jsonReq('http://localhost/api/candidates', 'POST', { name: 'Naga Iswarya Lakshmi Bhogadi', headline: 'Oracle DBA', total_experience_years: 4 }));
    const candidateId = ((await jsonBody(c)).candidate as Record<string, unknown>).id as string;
    const fd = new FormData();
    fd.append('file', new File([NAGA_RESUME], 'naga-resume.txt', { type: 'text/plain' }));
    await uploadResume(new Request(`http://localhost/api/candidates/${candidateId}/resumes`, { method: 'POST', body: fd }), { params: { id: candidateId } });
    const a = await createApplication(jsonReq('http://localhost/api/applications', 'POST', { candidate_id: candidateId, company: 'Harris Computer', title: 'Technical Consultant – Oracle DBA' }));
    const applicationId = ((await jsonBody(a)).application as Record<string, unknown>).id as string;
    await pasteJd(jsonReq(`http://localhost/api/applications/${applicationId}/jd`, 'POST', { jd_text: HARRIS_JD }), { params: { id: applicationId } });
    await createStar(jsonReq('http://localhost/api/star-stories', 'POST', {
      candidate_id: candidateId, title: 'RAC failover during patching',
      situation: 'A node failed during patching.', task: 'Restore service.', action: 'Failed over with Data Guard.', result: 'Zero data loss.',
      technologies: ['Oracle RAC', 'Data Guard'], verification_status: 'verified',
    }));

    const res = await generateSkill(jsonReq('http://localhost/api/natively/generate', 'POST', { application_id: applicationId }));
    expect(res.status).toBe(201);
    const body = await jsonBody(res);
    expect(body.status).toBe('synced');
    expect(body.skill_name as string).toContain('interview-naga-iswarya-lakshmi-bhogadi-harris-computer');
    const skillPath = body.skill_path as string;
    expect(fs.existsSync(skillPath)).toBe(true);
    const content = fs.readFileSync(skillPath, 'utf8');
    expect(content).toContain('Naga Iswarya Lakshmi Bhogadi');
    expect(content).toContain('Harris Computer');
    expect(content).toContain('Technical Consultant – Oracle DBA');
    expect(content).toContain('RAC failover during patching');
    expect(content).toContain('Oracle RAC');
    expect(content).toContain('Not demonstrated');
    expect(content).toContain('DXC Technology');
  });

  it('returns 404 for an unknown application', async () => {
    const res = await generateSkill(jsonReq('http://localhost/api/natively/generate', 'POST', { application_id: 'nope' }));
    expect(res.status).toBe(404);
  });

  it('requires application_id', async () => {
    const res = await generateSkill(jsonReq('http://localhost/api/natively/generate', 'POST', {}));
    expect(res.status).toBe(400);
  });
});
