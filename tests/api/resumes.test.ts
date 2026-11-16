import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTempDir, jsonBody, jsonReq, makeTempDataDir } from '../helpers';
import { NAGA_RESUME } from '../fixtures';

const dir = makeTempDataDir();
afterAll(() => cleanupTempDir(dir));

const { POST: createCandidate } = await import('@/app/api/candidates/route');
const { GET: listResumes, POST: uploadResume } = await import('@/app/api/candidates/[id]/resumes/route');

async function makeCandidate(): Promise<string> {
  const res = await createCandidate(jsonReq('http://localhost/api/candidates', 'POST', { name: 'Naga Iswarya Lakshmi Bhogadi' }));
  return ((await jsonBody(res)).candidate as Record<string, unknown>).id as string;
}

function uploadReq(candidateId: string, file: File): Request {
  const fd = new FormData();
  fd.append('file', file);
  return new Request(`http://localhost/api/candidates/${candidateId}/resumes`, { method: 'POST', body: fd });
}

describe('resume txt upload + parse', () => {
  it('uploads a txt resume, parses skills/employment/education/certs', async () => {
    const id = await makeCandidate();
    const res = await uploadResume(uploadReq(id, new File([NAGA_RESUME], 'naga-resume.txt', { type: 'text/plain' })), { params: { id } });
    expect(res.status).toBe(201);
    const resume = (await jsonBody(res)).resume as Record<string, unknown>;
    expect(resume.filename).toBe('naga-resume.txt');
    expect(resume.version).toBe(1);
    expect(resume.is_active).toBe(true);
    const parsed = resume.parsed as Record<string, unknown>;
    expect(parsed.skills as string[]).toEqual(expect.arrayContaining(['Oracle RAC', 'RMAN']));
    expect((parsed.employment as Array<Record<string, unknown>>).length).toBeGreaterThanOrEqual(1);
    expect((parsed.education as Array<Record<string, unknown>>).length).toBeGreaterThanOrEqual(1);
    expect((parsed.certifications as string[]).some((c) => /Oracle Certified Associate/i.test(c))).toBe(true);
    expect(parsed.extraction_quality as number).toBeGreaterThanOrEqual(80);
    expect(resume.extracted_text as string).toContain('DXC Technology');

    const list = await listResumes(new Request(`http://localhost/api/candidates/${id}/resumes`), { params: { id } });
    expect(((await jsonBody(list)).resumes as unknown[]).length).toBe(1);
  });

  it('rejects an empty file upload', async () => {
    const id = await makeCandidate();
    const res = await uploadResume(uploadReq(id, new File([], 'empty.txt', { type: 'text/plain' })), { params: { id } });
    expect(res.status).toBe(400);
    expect(((await jsonBody(res)).error as string)).toMatch(/empty/i);
  });

  it('rejects an oversized upload with 413', async () => {
    const id = await makeCandidate();
    const big = new File([new Uint8Array(11 * 1024 * 1024)], 'big.txt', { type: 'text/plain' });
    const res = await uploadResume(uploadReq(id, big), { params: { id } });
    expect(res.status).toBe(413);
  });

  it('rejects a disallowed extension', async () => {
    const id = await makeCandidate();
    const res = await uploadResume(uploadReq(id, new File(['x'], 'evil.exe', { type: 'application/octet-stream' })), { params: { id } });
    expect(res.status).toBe(400);
  });

  it('sanitises a path-traversal filename on disk', async () => {
    const id = await makeCandidate();
    const res = await uploadResume(uploadReq(id, new File([NAGA_RESUME], '../../evil.txt', { type: 'text/plain' })), { params: { id } });
    expect(res.status).toBe(201);
    const resume = (await jsonBody(res)).resume as Record<string, unknown>;
    expect(resume.stored_path as string).not.toContain('..');
    expect(resume.stored_path as string).toContain(`uploads/${id}/`);
  });

  it('returns 404 for an unknown candidate', async () => {
    const res = await uploadResume(uploadReq('nope', new File([NAGA_RESUME], 'r.txt', { type: 'text/plain' })), { params: { id: 'nope' } });
    expect(res.status).toBe(404);
  });
});
