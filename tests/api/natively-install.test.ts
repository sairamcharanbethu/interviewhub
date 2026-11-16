import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTempDir, jsonBody, jsonReq, makeTempDataDir } from '../helpers';
import { HARRIS_JD, NAGA_RESUME } from '../fixtures';

const dir = makeTempDataDir();
// A stand-in for Natively's Skills directory (verified via env var).
const nativelyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-natively-'));
process.env.NATIVELY_SKILLS_DIR = nativelyDir;
afterAll(() => {
  delete process.env.NATIVELY_SKILLS_DIR;
  cleanupTempDir(dir);
  fs.rmSync(nativelyDir, { recursive: true, force: true });
});

const { POST: createCandidate } = await import('@/app/api/candidates/route');
const { POST: uploadResume } = await import('@/app/api/candidates/[id]/resumes/route');
const { POST: createApplication } = await import('@/app/api/applications/route');
const { POST: pasteJd } = await import('@/app/api/applications/[id]/jd/route');
const { GET: installConfig } = await import('@/app/api/natively/install-config/route');
const { POST: install } = await import('@/app/api/natively/install/route');
const { POST: uninstall } = await import('@/app/api/natively/uninstall/route');
const { GET: status } = await import('@/app/api/natively/status/route');
const installLib = await import('@/lib/natively-install');
const nativelyLib = await import('@/lib/natively');
const dbLib = await import('@/lib/db');

async function makeApplication(company: string, title: string, jd: string) {
  const c = await createCandidate(jsonReq('http://localhost/api/candidates', 'POST', { name: 'Naga Iswarya Lakshmi Bhogadi', headline: 'Oracle DBA', total_experience_years: 4 }));
  const candidateId = ((await jsonBody(c)).candidate as Record<string, unknown>).id as string;
  const fd = new FormData();
  fd.append('file', new File([NAGA_RESUME], 'naga-resume.txt', { type: 'text/plain' }));
  await uploadResume(new Request(`http://localhost/api/candidates/${candidateId}/resumes`, { method: 'POST', body: fd }), { params: { id: candidateId } });
  const a = await createApplication(jsonReq('http://localhost/api/applications', 'POST', { candidate_id: candidateId, company, title }));
  const applicationId = ((await jsonBody(a)).application as Record<string, unknown>).id as string;
  await pasteJd(jsonReq(`http://localhost/api/applications/${applicationId}/jd`, 'POST', { jd_text: jd }), { params: { id: applicationId } });
  return { candidateId, applicationId };
}

let appA: { applicationId: string };

beforeAll(async () => {
  appA = await makeApplication('Harris Computer', 'Technical Consultant – Oracle DBA', HARRIS_JD);
});

describe('install-config', () => {
  it('reports the configured directory as verified', async () => {
    const res = await installConfig();
    const body = await jsonBody(res);
    expect(body.configured).toBe(true);
    expect(body.source).toBe('env');
    expect(body.resolved_path).toBe(nativelyDir);
    expect(body.verified).toBe(true);
  });
  it('is unconfigured when NATIVELY_SKILLS_DIR is unset on this platform', async () => {
    delete process.env.NATIVELY_SKILLS_DIR;
    const res = await installConfig();
    const body = await jsonBody(res);
    if (process.platform !== 'darwin') {
      expect(body.configured).toBe(false);
      expect(body.resolved_path).toBeNull();
    }
    process.env.NATIVELY_SKILLS_DIR = nativelyDir;
  });
});

describe('install new skill', () => {
  it('installs <slug>/SKILL.md with the right content and records installed', async () => {
    const res = await install(jsonReq('http://localhost/api/natively/install', 'POST', { application_id: appA.applicationId }));
    expect(res.status).toBe(201);
    const body = await jsonBody(res);
    expect(body.status).toBe('installed');
    expect(body.slug as string).toMatch(/^interview-/);
    expect((body.slug as string).length).toBeLessThanOrEqual(80);
    expect(body.slash_command).toBe(`/${body.slug as string}`);
    expect(body.skill_path as string).toBe(path.join(nativelyDir, body.slug as string, 'SKILL.md'));
    expect(fs.existsSync(body.skill_path as string)).toBe(true);
    const content = fs.readFileSync(body.skill_path as string, 'utf8');
    expect(content).toContain('Naga Iswarya Lakshmi Bhogadi');
    expect(content).toContain('Harris Computer');
    expect(content).toContain('Oracle RAC');
    expect(content).toContain('name: "interview-');
    const row = dbLib.get<Record<string, unknown>>(`SELECT * FROM skills_sync WHERE application_id = ?`, appA.applicationId)!;
    expect(row.status).toBe('installed');
    expect(row.install_method).toBe('natively-auto');
    expect(row.install_slug).toBe(body.slug);
    expect(row.install_path).toBe(body.skill_path);
    expect(row.installed_at).toBeTruthy();
  });

  it('re-installing the same content is an idempotent update', async () => {
    const res = await install(jsonReq('http://localhost/api/natively/install', 'POST', { application_id: appA.applicationId }));
    expect(res.status).toBe(201);
    expect((await jsonBody(res)).unchanged).toBe(true);
  });

  it('reports update_available after the JD changes, then updates', async () => {
    await pasteJd(jsonReq(`http://localhost/api/applications/${appA.applicationId}/jd`, 'POST', { jd_text: `${HARRIS_JD}\n\nADDITIONAL REQUIREMENT: Experience with GoldenGate replication is a strong plus.` }), { params: { id: appA.applicationId } });
    const s = await status(new Request(`http://localhost/api/natively/status?application_id=${appA.applicationId}`));
    const sBody = await jsonBody(s);
    expect((sBody.install as Record<string, unknown>).update_available).toBe(true);
    const res = await install(jsonReq('http://localhost/api/natively/install', 'POST', { application_id: appA.applicationId }));
    expect(res.status).toBe(201);
    const content = fs.readFileSync((await jsonBody(res)).skill_path as string, 'utf8');
    expect(content).toContain('GoldenGate');
    const s2 = await status(new Request(`http://localhost/api/natively/status?application_id=${appA.applicationId}`));
    expect(((await jsonBody(s2)).install as Record<string, unknown>).update_available).toBe(false);
  });
});

describe('duplicate slugs and foreign folders', () => {
  it('a second application with the same company/title gets a different slug and both folders survive', async () => {
    const appB = await makeApplication('Harris Computer', 'Technical Consultant – Oracle DBA', `${HARRIS_JD}\n\nNOTE FOR APP B: This posting emphasises Exadata performance tuning.`);
    const res = await install(jsonReq('http://localhost/api/natively/install', 'POST', { application_id: appB.applicationId }));
    expect(res.status).toBe(201);
    const body = await jsonBody(res);
    const slugA = (dbLib.get<Record<string, unknown>>(`SELECT install_slug FROM skills_sync WHERE application_id = ?`, appA.applicationId)!.install_slug as string);
    expect(body.slug).not.toBe(slugA);
    expect(fs.existsSync(path.join(nativelyDir, slugA, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(nativelyDir, body.slug as string, 'SKILL.md'))).toBe(true);
    expect(fs.readFileSync(path.join(nativelyDir, body.slug as string, 'SKILL.md'), 'utf8')).toContain('Exadata performance tuning');
  });

  it('a foreign folder with the slug requires confirmation, then is preserved as a backup', async () => {
    const appC = await makeApplication('Acme Corp', 'Senior DBA', HARRIS_JD);
    const slug = installLib.installSlugFor(
      nativelyLib.skillNameFor('Naga Iswarya Lakshmi Bhogadi', 'Acme Corp', 'Senior DBA'),
    );
    const foreignFolder = path.join(nativelyDir, slug);
    fs.mkdirSync(foreignFolder, { recursive: true });
    fs.writeFileSync(path.join(foreignFolder, 'SKILL.md'), '---\nname: "foreign-skill"\ndescription: "not ours"\n---\nFOREIGN CONTENT');
    const denied = await install(jsonReq('http://localhost/api/natively/install', 'POST', { application_id: appC.applicationId }));
    expect(denied.status).toBe(409);
    expect((await jsonBody(denied)).needs_confirmation).toBe(true);
    expect(fs.readFileSync(path.join(foreignFolder, 'SKILL.md'), 'utf8')).toContain('FOREIGN CONTENT');
    const ok = await install(jsonReq('http://localhost/api/natively/install', 'POST', { application_id: appC.applicationId, confirm_overwrite: true }));
    expect(ok.status).toBe(201);
    expect(fs.readFileSync(path.join(foreignFolder, 'SKILL.md'), 'utf8')).toContain('Naga Iswarya Lakshmi Bhogadi');
    const backups = fs.readdirSync(nativelyDir).filter((f) => f.startsWith(`${slug}.backup-`));
    expect(backups.length).toBe(1);
    expect(fs.readFileSync(path.join(nativelyDir, backups[0], 'SKILL.md'), 'utf8')).toContain('FOREIGN CONTENT');
  });

  it('refuses a symlinked slug folder that escapes the directory', async () => {
    const appD = await makeApplication('Globex', 'Database Engineer', HARRIS_JD);
    const slug = installLib.installSlugFor(
      nativelyLib.skillNameFor('Naga Iswarya Lakshmi Bhogadi', 'Globex', 'Database Engineer'),
    );
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-outside-'));
    fs.symlinkSync(outside, path.join(nativelyDir, slug), 'dir');
    const res = await install(jsonReq('http://localhost/api/natively/install', 'POST', { application_id: appD.applicationId }));
    expect([403, 500]).toContain(res.status);
    expect(fs.existsSync(path.join(outside, 'SKILL.md'))).toBe(false);
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

describe('unconfigured install is blocked', () => {
  it('returns 400 when no Natively directory is configured', async () => {
    delete process.env.NATIVELY_SKILLS_DIR;
    if (process.platform !== 'darwin') {
      const res = await install(jsonReq('http://localhost/api/natively/install', 'POST', { application_id: appA.applicationId }));
      expect(res.status).toBe(400);
    }
    process.env.NATIVELY_SKILLS_DIR = nativelyDir;
  });
});

describe('100 KiB file limit', () => {
  it('rejects an install whose Skill exceeds Natively\'s per-file limit', async () => {
    // Insert the huge documents directly (no RAG chunks) so the builder
    // falls back to raw excerpts at the 200k budget — RAG chunks alone
    // could never exceed the 100 KiB cap (14 chunks x ~800 chars).
    const bigResumeText = `Naga Iswarya Lakshmi Bhogadi\nOracle DBA\n${'Administered Oracle 19c RAC clusters, Data Guard, RMAN backups, and performance tuning on Linux. '.repeat(1800)}`;
    const bigJdText = `${HARRIS_JD}\n${'The role requires deep Oracle RAC, Data Guard, RMAN, and performance tuning experience. '.repeat(1200)}`;
    dbLib.run(`INSERT INTO candidates (id, name, created_at, updated_at) VALUES ('cand_big', 'Naga Iswarya Lakshmi Bhogadi', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`);
    dbLib.run(
      `INSERT INTO resumes (id, candidate_id, filename, stored_path, version, is_active, extracted_text, parsed, created_at) VALUES ('resume_big', 'cand_big', 'big.txt', 'uploads/cand_big/big.txt', 1, 1, ?, '{}', '2026-01-01 00:00:00')`,
      bigResumeText,
    );
    dbLib.run(
      `INSERT INTO applications (id, candidate_id, company, title, selected_resume_id, jd_text, created_at, updated_at) VALUES ('app_big', 'cand_big', 'BigCorp', 'Oracle DBA', 'resume_big', ?, '2026-01-01 00:00:00', '2026-01-01 00:00:00')`,
      bigJdText,
    );
    dbLib.run(`UPDATE ai_settings SET skill_context_chars = 200000 WHERE id = 1`);
    try {
      const res = await install(jsonReq('http://localhost/api/natively/install', 'POST', { application_id: 'app_big' }));
      expect(res.status).toBe(413);
      expect((await jsonBody(res)).error as string).toMatch(/100.*KiB|102400/i);
    } finally {
      dbLib.run(`UPDATE ai_settings SET skill_context_chars = 12000 WHERE id = 1`);
    }
  });
});

describe('uninstall', () => {
  it('removes only the managed folder and preserves unrelated skills', async () => {
    const unrelated = path.join(nativelyDir, 'some-other-skill');
    fs.mkdirSync(unrelated, { recursive: true });
    fs.writeFileSync(path.join(unrelated, 'SKILL.md'), '---\nname: "some-other-skill"\ndescription: "unrelated"\n---\nKEEP ME');
    const slugA = (dbLib.get<Record<string, unknown>>(`SELECT install_slug FROM skills_sync WHERE application_id = ?`, appA.applicationId)!.install_slug as string);
    const res = await uninstall(jsonReq('http://localhost/api/natively/uninstall', 'POST', { application_id: appA.applicationId }));
    expect(res.status).toBe(200);
    expect((await jsonBody(res)).status).toBe('uninstalled');
    expect(fs.existsSync(path.join(nativelyDir, slugA))).toBe(false);
    expect(fs.readFileSync(path.join(unrelated, 'SKILL.md'), 'utf8')).toContain('KEEP ME');
    const row = dbLib.get<Record<string, unknown>>(`SELECT status FROM skills_sync WHERE application_id = ?`, appA.applicationId)!;
    expect(row.status).toBe('uninstalled');
  });

  it('refuses to uninstall a folder whose contents changed outside InterviewHub', async () => {
    const appE = await makeApplication('Initech', 'Oracle DBA', HARRIS_JD);
    const res = await install(jsonReq('http://localhost/api/natively/install', 'POST', { application_id: appE.applicationId }));
    const slug = (await jsonBody(res)).slug as string;
    fs.writeFileSync(path.join(nativelyDir, slug, 'SKILL.md'), 'TAMPERED BY HAND');
    const denied = await uninstall(jsonReq('http://localhost/api/natively/uninstall', 'POST', { application_id: appE.applicationId }));
    expect(denied.status).toBe(409);
    expect(fs.existsSync(path.join(nativelyDir, slug, 'SKILL.md'))).toBe(true);
  });

  it('returns 404 when nothing is installed for the application', async () => {
    const appF = await makeApplication('Umbrella', 'DBA', HARRIS_JD);
    const res = await uninstall(jsonReq('http://localhost/api/natively/uninstall', 'POST', { application_id: appF.applicationId }));
    expect(res.status).toBe(404);
  });
});

describe('manual export still works', () => {
  it('generate still writes the standalone interview-*.md to the manual dir', async () => {
    const { POST: generate } = await import('@/app/api/natively/generate/route');
    const res = await generate(jsonReq('http://localhost/api/natively/generate', 'POST', { application_id: appA.applicationId, confirm_overwrite: true }));
    expect(res.status).toBe(201);
    expect((await jsonBody(res)).status).toBe('file_written');
  });
});
