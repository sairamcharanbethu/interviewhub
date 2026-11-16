import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTempDir, jsonBody, jsonReq, makeTempDataDir } from '../helpers';
import { HARRIS_JD, NAGA_RESUME } from '../fixtures';

const dir = makeTempDataDir();
afterAll(() => cleanupTempDir(dir));

const { POST: createCandidate } = await import('@/app/api/candidates/route');
const { POST: uploadResume } = await import('@/app/api/candidates/[id]/resumes/route');
const { DELETE: deleteCandidate } = await import('@/app/api/candidates/[id]/route');
const { POST: createApplication } = await import('@/app/api/applications/route');
const { PATCH: patchApplication } = await import('@/app/api/applications/[id]/route');
const { POST: parseJd } = await import('@/app/api/applications/parse-jd/route');
const { GET: getNativelySettings, POST: setNativelySettings } = await import('@/app/api/natively/settings/route');
const dbLib = await import('@/lib/db');
const cleanupLib = await import('@/lib/cleanup');

async function makeCandidate(name: string): Promise<string> {
  const c = await createCandidate(jsonReq('http://localhost/api/candidates', 'POST', { name }));
  expect(c.status).toBe(201);
  return ((await jsonBody(c)).candidate as Record<string, unknown>).id as string;
}

async function uploadTxtResume(candidateId: string, text = NAGA_RESUME): Promise<string> {
  const fd = new FormData();
  fd.append('file', new File([text], 'resume.txt', { type: 'text/plain' }));
  const up = await uploadResume(
    new Request(`http://localhost/api/candidates/${candidateId}/resumes`, { method: 'POST', body: fd }),
    { params: { id: candidateId } },
  );
  expect(up.status).toBe(201);
  return ((await jsonBody(up)).resume as Record<string, unknown>).id as string;
}

function jdFileReq(file: File): Request {
  const fd = new FormData();
  fd.append('file', file);
  return new Request('http://localhost/api/applications/parse-jd', { method: 'POST', body: fd });
}

describe('reconciliation: parse-jd upload validation (was missing validateUploadBytes)', () => {
  it('rejects a text file renamed to .pdf', async () => {
    const res = await parseJd(jdFileReq(new File([HARRIS_JD], 'jd.pdf', { type: 'application/pdf' })));
    expect(res.status).toBe(400);
    expect(((await jsonBody(res)).error as string) || '').toMatch(/%PDF/);
  });

  it('rejects a fake .docx with no ZIP / Word package structure', async () => {
    const res = await parseJd(jdFileReq(new File(['not a zip at all'], 'jd.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })));
    expect(res.status).toBe(400);
    expect(((await jsonBody(res)).error as string) || '').toMatch(/ZIP|DOCX/);
  });

  it('rejects a ZIP that is not a Word package (missing [Content_Types].xml)', async () => {
    const fakeZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
    const res = await parseJd(jdFileReq(new File([fakeZip], 'jd.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })));
    expect(res.status).toBe(400);
  });

  it('accepts a genuine .txt JD file', async () => {
    const res = await parseJd(jdFileReq(new File([HARRIS_JD], 'jd.txt', { type: 'text/plain' })));
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(typeof body.jd_text).toBe('string');
    expect((body.parsed as Record<string, unknown>).required_skills).toBeDefined();
  });
});

describe('reconciliation: selected_resume_id is validated on write, not just on use', () => {
  it('POST/PATCH reject a resume of another candidate or a missing resume', async () => {
    const candA = await makeCandidate('Recon A');
    const candB = await makeCandidate('Recon B');
    const resumeA = await uploadTxtResume(candA);
    const resumeB = await uploadTxtResume(candB);

    const badOther = await createApplication(jsonReq('http://localhost/api/applications', 'POST', {
      candidate_id: candA, company: 'X Corp', title: 'DBA', selected_resume_id: resumeB,
    }));
    expect(badOther.status).toBe(400);
    const badMissing = await createApplication(jsonReq('http://localhost/api/applications', 'POST', {
      candidate_id: candA, company: 'X Corp', title: 'DBA', selected_resume_id: 'resume_does_not_exist',
    }));
    expect(badMissing.status).toBe(400);

    const ok = await createApplication(jsonReq('http://localhost/api/applications', 'POST', {
      candidate_id: candA, company: 'X Corp', title: 'DBA', selected_resume_id: resumeA,
    }));
    expect(ok.status).toBe(201);
    const appId = ((await jsonBody(ok)).application as Record<string, unknown>).id as string;

    const badPatch = await patchApplication(
      jsonReq(`http://localhost/api/applications/${appId}`, 'PATCH', { selected_resume_id: resumeB }),
      { params: { id: appId } },
    );
    expect(badPatch.status).toBe(400);
    const clear = await patchApplication(
      jsonReq(`http://localhost/api/applications/${appId}`, 'PATCH', { selected_resume_id: null }),
      { params: { id: appId } },
    );
    expect(clear.status).toBe(200);
    expect(((await jsonBody(clear)).application as Record<string, unknown>).selected_resume_id).toBeNull();
  });
});

describe('reconciliation: cleanup never deletes outside configured storage', () => {
  it('deleteFilesSafely refuses a path outside DATA_DIR / SKILLS_DIR', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-outside-'));
    const sentinel = path.join(outside, 'keep-me.txt');
    fs.writeFileSync(sentinel, 'do not delete');
    try {
      const result = cleanupLib.deleteFilesSafely([sentinel]);
      expect(result.removed).toEqual([]);
      expect(result.errors.join(' ')).toMatch(/outside configured storage/);
      expect(fs.existsSync(sentinel)).toBe(true);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('permanent candidate delete removes its own upload but leaves an outside file alone', async () => {
    const cand = await makeCandidate('Recon Cleanup');
    const resumeId = await uploadTxtResume(cand);
    const row = dbLib.get<{ stored_path: string }>(`SELECT stored_path FROM resumes WHERE id = ?`, resumeId)!;
    const realFile = path.join(dir, row.stored_path);
    expect(fs.existsSync(realFile)).toBe(true);

    // Craft a resume row whose stored_path points OUTSIDE the data dir
    // (simulating a tampered / legacy DB value). Cleanup must refuse it.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-outside-'));
    const sentinel = path.join(outside, 'keep-me.txt');
    fs.writeFileSync(sentinel, 'do not delete');
    dbLib.run(
      `INSERT INTO resumes (id, candidate_id, filename, stored_path, version, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'resume_outside', cand, 'evil.txt', sentinel, 99, 0, '2026-01-01 00:00:00',
    );
    try {
      const res = await deleteCandidate(
        new Request(`http://localhost/api/candidates/${cand}?permanent=true`, { method: 'DELETE' }),
        { params: { id: cand } },
      );
      expect(res.status).toBe(200);
      const body = await jsonBody(res);
      expect(fs.existsSync(realFile)).toBe(false);
      expect(fs.existsSync(sentinel)).toBe(true);
      expect((body.file_errors as string[]).join(' ')).toMatch(/outside configured storage/);
      expect(dbLib.get(`SELECT * FROM resumes WHERE id = ?`, 'resume_outside')).toBeUndefined();
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('reconciliation: Skill context budget is configurable (API + persisted)', () => {
  it('GET returns the default, POST persists a new budget, GET returns it', async () => {
    const before = await getNativelySettings();
    expect(before.status).toBe(200);
    expect(((await jsonBody(before)) as Record<string, unknown>).skill_context_chars).toBe(12000);
    const bad = await setNativelySettings(jsonReq('http://localhost/api/natively/settings', 'POST', { skill_context_chars: 10 }));
    expect(bad.status).toBe(400);
    const set = await setNativelySettings(jsonReq('http://localhost/api/natively/settings', 'POST', { skill_context_chars: 5000 }));
    expect(set.status).toBe(200);
    expect(((await jsonBody(set)) as Record<string, unknown>).skill_context_chars).toBe(5000);
    const after = await getNativelySettings();
    expect(((await jsonBody(after)) as Record<string, unknown>).skill_context_chars).toBe(5000);
    const { skillContextChars } = await import('@/lib/natively');
    expect(skillContextChars()).toBe(5000);
    // Restore the default so later tests (and the E2E run) see the standard budget.
    await setNativelySettings(jsonReq('http://localhost/api/natively/settings', 'POST', { skill_context_chars: 12000 }));
  });
});
