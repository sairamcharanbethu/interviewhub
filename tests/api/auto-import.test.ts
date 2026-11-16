import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTempDir, jsonBody, jsonReq, makeTempDataDir } from '../helpers';
import { NAGA_RESUME, HARRIS_JD } from '../fixtures';

const dir = makeTempDataDir();
afterAll(() => cleanupTempDir(dir));

const { POST: parseResume } = await import('@/app/api/candidates/parse-resume/route');
const { POST: parseJd } = await import('@/app/api/applications/parse-jd/route');
const { GET: listCandidates } = await import('@/app/api/candidates/route');
const { GET: listApplications } = await import('@/app/api/applications/route');

function fileReq(url: string, file: File): Request {
  const fd = new FormData();
  fd.append('file', file);
  return new Request(url, { method: 'POST', body: fd });
}

describe('resume-first parse (no creation)', () => {
  it('parses the Naga resume and returns profile fields without creating a candidate', async () => {
    const res = await parseResume(fileReq('http://localhost/api/candidates/parse-resume', new File([NAGA_RESUME], 'naga-resume.txt', { type: 'text/plain' })));
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    const parsed = body.parsed as Record<string, unknown>;
    expect(parsed.name).toBe('Naga Iswarya Lakshmi Bhogadi');
    expect(parsed.location as string).toContain('Mississauga');
    expect(parsed.headline as string).toMatch(/Oracle DBA/i);
    expect((parsed.employment as Array<Record<string, unknown>>)[0].employer).toBe('DXC Technology');
    expect((parsed.employment as Array<Record<string, unknown>>)[0].title).toBe('Software Engineer');
    expect(body.quality as number).toBeGreaterThanOrEqual(80);
    // Nothing was created.
    const list = await listCandidates(new Request('http://localhost/api/candidates'));
    expect(((await jsonBody(list)).candidates as unknown[]).length).toBe(0);
  });

  it('rejects an empty file with 400', async () => {
    const res = await parseResume(fileReq('http://localhost/api/candidates/parse-resume', new File([], 'empty.txt', { type: 'text/plain' })));
    expect(res.status).toBe(400);
  });

  it('rejects a disallowed extension with 400', async () => {
    const res = await parseResume(fileReq('http://localhost/api/candidates/parse-resume', new File(['x'], 'evil.exe', { type: 'application/octet-stream' })));
    expect(res.status).toBe(400);
  });

  it('rejects a non-multipart request with 400', async () => {
    const res = await parseResume(new Request('http://localhost/api/candidates/parse-resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
    expect(res.status).toBe(400);
  });
});

describe('JD-first parse (no creation)', () => {
  it('parses pasted JD text and returns an inferred draft without creating an application', async () => {
    const res = await parseJd(jsonReq('http://localhost/api/applications/parse-jd', 'POST', { jd_text: HARRIS_JD }));
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    const draft = body.draft as Record<string, unknown>;
    expect(draft.company).toBe('Harris Computer');
    expect(draft.title as string).toContain('Oracle DBA');
    expect(draft.location as string).toContain('Remote');
    expect((body.parsed as Record<string, unknown>).company).toBe('Harris Computer');
    expect(body.jd_text as string).toContain('Oracle RAC');
    const list = await listApplications(new Request('http://localhost/api/applications'));
    expect(((await jsonBody(list)).applications as unknown[]).length).toBe(0);
  });

  it('returns blank (null) draft fields when nothing can be inferred', async () => {
    const res = await parseJd(jsonReq('http://localhost/api/applications/parse-jd', 'POST', { jd_text: 'Some random text about databases and tuning.' }));
    expect(res.status).toBe(200);
    const draft = ((await jsonBody(res)).draft as Record<string, unknown>);
    expect(draft.company).toBeNull();
    expect(draft.title).toBeNull();
    expect(draft.location).toBeNull();
  });

  it('rejects empty JD text with 400', async () => {
    const res = await parseJd(jsonReq('http://localhost/api/applications/parse-jd', 'POST', { jd_text: '   ' }));
    expect(res.status).toBe(400);
  });

  it('rejects an invalid job URL with 400', async () => {
    const res = await parseJd(jsonReq('http://localhost/api/applications/parse-jd', 'POST', { job_url: 'not a url' }));
    expect(res.status).toBe(400);
  });

  it('returns 502 naming the paste fallback for an unreachable job URL', async () => {
    const res = await parseJd(jsonReq('http://localhost/api/applications/parse-jd', 'POST', { job_url: 'http://localhost:1/jobs/123' }));
    expect(res.status).toBe(502);
    const body = await jsonBody(res);
    expect(body.error as string).toMatch(/Paste the job description/i);
  });

  it('parses an uploaded JD file', async () => {
    const res = await parseJd(fileReq('http://localhost/api/applications/parse-jd', new File([HARRIS_JD], 'jd.txt', { type: 'text/plain' })));
    expect(res.status).toBe(200);
    expect(((await jsonBody(res)).draft as Record<string, unknown>).company).toBe('Harris Computer');
  });
});
