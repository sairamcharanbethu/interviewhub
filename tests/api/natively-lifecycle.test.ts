import fs from 'fs';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTempDir, jsonBody, jsonReq, makeTempDataDir } from '../helpers';
import { HARRIS_JD } from '../fixtures';

const dir = makeTempDataDir();
afterAll(() => cleanupTempDir(dir));

const { POST: createCandidate } = await import('@/app/api/candidates/route');
const { POST: uploadResume } = await import('@/app/api/candidates/[id]/resumes/route');
const { GET: listResumes } = await import('@/app/api/candidates/[id]/resumes/route');
const { POST: createApplication } = await import('@/app/api/applications/route');
const { GET: getApplication, DELETE: deleteApplication } = await import('@/app/api/applications/[id]/route');
const { DELETE: deleteCandidate } = await import('@/app/api/candidates/[id]/route');
const { POST: pasteJd } = await import('@/app/api/applications/[id]/jd/route');
const { POST: match } = await import('@/app/api/applications/[id]/match/route');
const { POST: generateSkill } = await import('@/app/api/natively/generate/route');
const { GET: skillStatus } = await import('@/app/api/natively/status/route');
const { POST: previewSkill } = await import('@/app/api/natively/preview/route');
const { POST: confirmSkill } = await import('@/app/api/natively/confirm/route');
const { GET: listVersions, POST: restoreVersion } = await import('@/app/api/natively/versions/route');
const { DELETE: deleteSkill } = await import('@/app/api/natively/delete/route');

const RESUME_R1 = `Naga Iswarya Lakshmi Bhogadi\nOracle DBA\nAlphaProject-UNIQUE-111\nAdministered Oracle RAC clusters and Data Guard for 40+ databases.\nSkills: Oracle, Oracle RAC, Data Guard, RMAN, PL/SQL, SQL, Linux\n`;
const RESUME_R2 = `Naga Iswarya Lakshmi Bhogadi\nCloud Database Engineer\nBetaProject-UNIQUE-222\nBuilt Kubernetes operators and AWS RDS automation in Python.\nSkills: Kubernetes, AWS, Python, Docker, Terraform, SQL\n`;

async function mkCandidate(name: string): Promise<string> {
  const res = await createCandidate(jsonReq('http://localhost/api/candidates', 'POST', { name, location: 'Mississauga' }));
  expect(res.status).toBe(201);
  return ((await jsonBody(res)).candidate as Record<string, unknown>).id as string;
}

async function upload(candidateId: string, text: string, filename: string): Promise<string> {
  const fd = new FormData();
  fd.append('file', new File([text], filename, { type: 'text/plain' }));
  const res = await uploadResume(new Request(`http://localhost/api/candidates/${candidateId}/resumes`, { method: 'POST', body: fd }), { params: { id: candidateId } });
  expect(res.status).toBe(201);
  return ((await jsonBody(res)).resume as Record<string, unknown>).id as string;
}

async function mkApp(candidateId: string, company: string, title: string, resumeId?: string): Promise<string> {
  const res = await createApplication(jsonReq('http://localhost/api/applications', 'POST', { candidate_id: candidateId, company, title, ...(resumeId ? { selected_resume_id: resumeId } : {}) }));
  expect(res.status).toBe(201);
  return ((await jsonBody(res)).application as Record<string, unknown>).id as string;
}

async function setJd(appId: string, jd: string) {
  const res = await pasteJd(jsonReq(`http://localhost/api/applications/${appId}/jd`, 'POST', { jd_text: jd }), { params: { id: appId } });
  expect(res.status).toBe(200);
}

async function gen(appId: string, confirm = false) {
  return generateSkill(jsonReq('http://localhost/api/natively/generate', 'POST', { application_id: appId, confirm_overwrite: confirm }));
}

async function statusOf(appId: string) {
  const res = await skillStatus(new Request(`http://localhost/api/natively/status?application_id=${appId}`));
  expect(res.status).toBe(200);
  return jsonBody(res);
}

describe('Natively lifecycle: two resumes, two companies, one candidate', () => {
  it('each Skill contains its own selected resume — never the other one', async () => {
    const cand = await mkCandidate('Naga Iswarya Lakshmi Bhogadi');
    const r1 = await upload(cand, RESUME_R1, 'resume-r1.txt');
    const r2 = await upload(cand, RESUME_R2, 'resume-r2.txt');
    const appA = await mkApp(cand, 'Acme Corp', 'Oracle DBA', r1);
    const appB = await mkApp(cand, 'Beta Ltd', 'Cloud DBA', r2);
    await setJd(appA, HARRIS_JD);
    await setJd(appB, HARRIS_JD);

    // Match also honours the selection (shared resolver).
    const mA = await match(jsonReq(`http://localhost/api/applications/${appA}/match`, 'POST', {}), { params: { id: appA } });
    expect(((await jsonBody(mA)) as Record<string, unknown>).resume_id).toBe(r1);
    const mB = await match(jsonReq(`http://localhost/api/applications/${appB}/match`, 'POST', {}), { params: { id: appB } });
    expect(((await jsonBody(mB)) as Record<string, unknown>).resume_id).toBe(r2);

    // Preview does not write a file.
    const pv = await previewSkill(jsonReq('http://localhost/api/natively/preview', 'POST', { application_id: appA }));
    expect(pv.status).toBe(200);
    const pvBody = await jsonBody(pv);
    expect(pvBody.content as string).toContain('AlphaProject-UNIQUE-111');
    expect(pvBody.content as string).not.toContain('BetaProject-UNIQUE-222');
    expect(pvBody.content as string).toContain('employer requirements');

    const gA = await gen(appA);
    expect(gA.status).toBe(201);
    const bA = await jsonBody(gA);
    expect(bA.status).toBe('file_written');
    expect(bA.status).not.toBe('synced');
    expect(bA.status).not.toBe('imported');
    const contentA = fs.readFileSync(bA.skill_path as string, 'utf8');
    expect(contentA).toContain('AlphaProject-UNIQUE-111');
    expect(contentA).not.toContain('BetaProject-UNIQUE-222');
    expect(contentA).toContain('Resume evidence — v1');

    const gB = await gen(appB);
    expect(gB.status).toBe(201);
    const bB = await jsonBody(gB);
    const contentB = fs.readFileSync(bB.skill_path as string, 'utf8');
    expect(contentB).toContain('BetaProject-UNIQUE-222');
    expect(contentB).not.toContain('AlphaProject-UNIQUE-111');
    expect(contentB).toContain('Resume evidence — v2');

    // Manual lifecycle: file_written -> imported -> activation_verified.
    const st1 = await statusOf(appA);
    expect((st1.syncs as Array<Record<string, unknown>>)[0].status).toBe('file_written');
    expect(st1.outdated).toBe(false);
    const c1 = await confirmSkill(jsonReq('http://localhost/api/natively/confirm', 'POST', { application_id: appA, action: 'imported' }));
    expect(c1.status).toBe(200);
    expect(((await jsonBody(c1)) as Record<string, unknown>).status).toBe('imported');
    // Activation cannot be confirmed before import (fresh app B is still file_written).
    const bad = await confirmSkill(jsonReq('http://localhost/api/natively/confirm', 'POST', { application_id: appB, action: 'activated' }));
    expect(bad.status).toBe(409);
    const c2 = await confirmSkill(jsonReq('http://localhost/api/natively/confirm', 'POST', { application_id: appA, action: 'activated' }));
    expect(c2.status).toBe(200);
    expect(((await jsonBody(c2)) as Record<string, unknown>).status).toBe('activation_verified');
  });

  it('duplicate slugs get a stable -2 suffix and never overwrite', async () => {
    const cand = await mkCandidate('Sai Ram Charan Bethu');
    const r1 = await upload(cand, RESUME_R1, 'resume.txt');
    const appA = await mkApp(cand, 'Acme Corp', 'Oracle DBA', r1);
    const appB = await mkApp(cand, 'Acme Corp', 'Oracle DBA', r1);
    await setJd(appA, HARRIS_JD);
    await setJd(appB, HARRIS_JD);
    const gA = await gen(appA);
    const pathA = (await jsonBody(gA)).skill_path as string;
    const gB = await gen(appB);
    const bB = await jsonBody(gB);
    expect(bB.skill_name as string).toMatch(/-2$/);
    expect(bB.skill_path as string).not.toBe(pathA);
    // First file is untouched.
    expect(fs.readFileSync(pathA, 'utf8')).toContain('AlphaProject-UNIQUE-111');
    expect(fs.existsSync(bB.skill_path as string)).toBe(true);
  });

  it('regenerate requires confirmation, saves a version, flags outdated on JD change, restores', async () => {
    const cand = await mkCandidate('Outdated Case');
    await upload(cand, RESUME_R1, 'resume.txt');
    const app = await mkApp(cand, 'Acme Corp', 'Oracle DBA');
    await setJd(app, HARRIS_JD);
    const g1 = await gen(app);
    expect(g1.status).toBe(201);
    const path1 = (await jsonBody(g1)).skill_path as string;
    const original = fs.readFileSync(path1, 'utf8');
    // Second generate without confirmation -> 409, file untouched.
    const g2 = await gen(app, false);
    expect(g2.status).toBe(409);
    expect(fs.readFileSync(path1, 'utf8')).toBe(original);
    // JD change -> outdated.
    await setJd(app, 'ZZZ-NEW-JD-999\nSenior Oracle DBA needed. Must know Oracle RAC and Data Guard.');
    const st = await statusOf(app);
    expect(st.outdated).toBe(true);
    // Confirmed regenerate saves the previous version.
    const g3 = await gen(app, true);
    expect(g3.status).toBe(201);
    expect(fs.readFileSync(path1, 'utf8')).toContain('ZZZ-NEW-JD-999');
    const st2 = await statusOf(app);
    expect(st2.outdated).toBe(false);
    const vs = await listVersions(new Request(`http://localhost/api/natively/versions?application_id=${app}`));
    const versions = ((await jsonBody(vs)).versions as Array<Record<string, unknown>>);
    expect(versions.length).toBe(1);
    // Restore the previous version.
    const rv = await restoreVersion(jsonReq('http://localhost/api/natively/versions', 'POST', { application_id: app, version_number: 1 }));
    expect(rv.status).toBe(200);
    expect(fs.readFileSync(path1, 'utf8')).toContain('Harris Computer');
    expect(fs.readFileSync(path1, 'utf8')).not.toContain('ZZZ-NEW-JD-999');
  });

  it('delete Skill removes only the file; app and resumes remain', async () => {
    const cand = await mkCandidate('Delete Skill Case');
    await upload(cand, RESUME_R1, 'resume.txt');
    const app = await mkApp(cand, 'Acme Corp', 'Oracle DBA');
    await setJd(app, HARRIS_JD);
    const g = await gen(app);
    const skillPath = (await jsonBody(g)).skill_path as string;
    expect(fs.existsSync(skillPath)).toBe(true);
    const del = await deleteSkill(new Request(`http://localhost/api/natively/delete?application_id=${app}`, { method: 'DELETE' }));
    expect(del.status).toBe(200);
    expect(fs.existsSync(skillPath)).toBe(false);
    const got = await getApplication(new Request(`http://localhost/api/applications/${app}`), { params: { id: app } });
    expect(got.status).toBe(200);
    const rs = await listResumes(new Request(`http://localhost/api/candidates/${cand}/resumes`), { params: { id: cand } });
    expect(((await jsonBody(rs)).resumes as unknown[]).length).toBe(1);
  });

  it('permanent candidate delete removes upload files and Skill files; app delete preserves the other app', async () => {
    const cand = await mkCandidate('Cleanup Case');
    await upload(cand, RESUME_R1, 'resume-r1.txt');
    await upload(cand, RESUME_R2, 'resume-r2.txt');
    const appA = await mkApp(cand, 'Acme Corp', 'Oracle DBA');
    const appB = await mkApp(cand, 'Beta Ltd', 'Cloud DBA');
    await setJd(appA, HARRIS_JD);
    await setJd(appB, HARRIS_JD);
    const pA = (await jsonBody(await gen(appA))).skill_path as string;
    const pB = (await jsonBody(await gen(appB))).skill_path as string;
    // Delete app A permanently: only A's Skill goes; B's Skill and resumes stay.
    const delA = await deleteApplication(new Request(`http://localhost/api/applications/${appA}?permanent=true`, { method: 'DELETE' }), { params: { id: appA } });
    expect(delA.status).toBe(200);
    expect(fs.existsSync(pA)).toBe(false);
    expect(fs.existsSync(pB)).toBe(true);
    const rs = await listResumes(new Request(`http://localhost/api/candidates/${cand}/resumes`), { params: { id: cand } });
    expect(((await jsonBody(rs)).resumes as unknown[]).length).toBe(2);
    // Permanent candidate delete: everything owned by the candidate is gone.
    const uploadsDir = path.join(dir, 'uploads', cand);
    expect(fs.existsSync(uploadsDir)).toBe(true);
    const delC = await deleteCandidate(new Request(`http://localhost/api/candidates/${cand}?permanent=true`, { method: 'DELETE' }), { params: { id: cand } });
    expect(delC.status).toBe(200);
    const delBody = await jsonBody(delC);
    expect(delBody.files_removed as number).toBeGreaterThan(0);
    expect(fs.existsSync(uploadsDir)).toBe(false);
    expect(fs.existsSync(pB)).toBe(false);
  });
});
