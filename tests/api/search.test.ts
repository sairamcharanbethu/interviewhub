import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTempDir, jsonBody, jsonReq, makeTempDataDir } from '../helpers';

const dir = makeTempDataDir();
afterAll(() => cleanupTempDir(dir));

const { POST: createCandidate } = await import('@/app/api/candidates/route');
const { POST: uploadResume } = await import('@/app/api/candidates/[id]/resumes/route');
const { GET: search } = await import('@/app/api/search/route');

async function seedCandidate(name: string, resumeText: string): Promise<string> {
  const c = await createCandidate(jsonReq('http://localhost/api/candidates', 'POST', { name }));
  const id = ((await jsonBody(c)).candidate as Record<string, unknown>).id as string;
  const fd = new FormData();
  fd.append('file', new File([resumeText], 'resume.txt', { type: 'text/plain' }));
  const up = await uploadResume(new Request(`http://localhost/api/candidates/${id}/resumes`, { method: 'POST', body: fd }), { params: { id } });
  expect(up.status).toBe(201);
  return id;
}

describe('search isolation', () => {
  it('cross-candidate search returns nothing; own-candidate search finds the chunk', async () => {
    const a = await seedCandidate('Candidate Quokka', 'quokka-rac-failover specialist. Administered Oracle RAC clusters for five years.');
    const b = await seedCandidate('Candidate Zebra', 'zebra-dataguard-tablespace specialist. Managed Oracle Data Guard and tablespaces.');

    // B searching for A's unique term: nothing.
    const cross = await search(new Request(`http://localhost/api/search?q=quokka-rac-failover&candidate_id=${b}`));
    expect(cross.status).toBe(200);
    const crossBody = await jsonBody(cross);
    expect(crossBody.candidate_id).toBe(b);
    expect((crossBody.chunks as Array<Record<string, unknown>>).length).toBe(0);

    // A searching for its own term (hyphenated — must not 500): finds it.
    const own = await search(new Request(`http://localhost/api/search?q=quokka-rac-failover&candidate_id=${a}`));
    expect(own.status).toBe(200);
    const ownChunks = (await jsonBody(own)).chunks as Array<Record<string, unknown>>;
    expect(ownChunks.length).toBeGreaterThan(0);
    expect(ownChunks.every((c) => c.candidate_id === a)).toBe(true);
    expect(ownChunks.some((c) => (c.chunk_text as string).includes('quokka'))).toBe(true);
  });

  it('requires a candidate scope and a query', async () => {
    const noScope = await search(new Request('http://localhost/api/search?q=oracle'));
    expect(noScope.status).toBe(400);
    const noQ = await search(new Request('http://localhost/api/search?candidate_id=x'));
    expect(noQ.status).toBe(400);
  });
});
