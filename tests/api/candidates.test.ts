import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTempDir, jsonBody, jsonReq, makeTempDataDir } from '../helpers';

const dir = makeTempDataDir();
afterAll(() => cleanupTempDir(dir));

const { GET: listCandidates, POST: createCandidate } = await import('@/app/api/candidates/route');
const { GET: getCandidate, PATCH: patchCandidate, DELETE: deleteCandidate } = await import('@/app/api/candidates/[id]/route');
const { POST: archiveCandidate } = await import('@/app/api/candidates/[id]/archive/route');
const { POST: restoreCandidate } = await import('@/app/api/candidates/[id]/restore/route');
const { POST: duplicateCandidate } = await import('@/app/api/candidates/[id]/duplicate/route');
const { POST: setDefaultCandidate } = await import('@/app/api/candidates/[id]/set-default/route');

async function create(name = 'Naga Iswarya Lakshmi Bhogadi'): Promise<string> {
  const res = await createCandidate(jsonReq('http://localhost/api/candidates', 'POST', { name, location: 'Mississauga' }));
  expect(res.status).toBe(201);
  const body = await jsonBody(res);
  return (body.candidate as Record<string, unknown>).id as string;
}

describe('candidate CRUD', () => {
  it('creates, reads, patches, and lists a candidate', async () => {
    const id = await create();
    const got = await getCandidate(new Request(`http://localhost/api/candidates/${id}`), { params: { id } });
    expect(got.status).toBe(200);
    expect(((await jsonBody(got)).candidate as Record<string, unknown>).name).toBe('Naga Iswarya Lakshmi Bhogadi');

    const patched = await patchCandidate(jsonReq(`http://localhost/api/candidates/${id}`, 'PATCH', { headline: 'Oracle DBA' }), { params: { id } });
    expect(patched.status).toBe(200);
    expect(((await jsonBody(patched)).candidate as Record<string, unknown>).headline).toBe('Oracle DBA');

    const list = await listCandidates(new Request('http://localhost/api/candidates'));
    expect(list.status).toBe(200);
    const rows = (await jsonBody(list)).candidates as Array<Record<string, unknown>>;
    expect(rows.some((c) => c.id === id)).toBe(true);
  });

  it('rejects invalid input with 400', async () => {
    const res = await createCandidate(jsonReq('http://localhost/api/candidates', 'POST', { name: '' }));
    expect(res.status).toBe(400);
    const res2 = await createCandidate(jsonReq('http://localhost/api/candidates', 'POST', { name: 'X', email: 'nope' }));
    expect(res2.status).toBe(400);
  });

  it('returns 404 for an unknown candidate id', async () => {
    const res = await getCandidate(new Request('http://localhost/api/candidates/nope'), { params: { id: 'nope' } });
    expect(res.status).toBe(404);
  });

  it('archives and restores a candidate', async () => {
    const id = await create('Archive Me');
    const archived = await archiveCandidate(new Request('http://localhost/api/candidates/x/archive', { method: 'POST' }), { params: { id } });
    expect(archived.status).toBe(200);
    expect(((await jsonBody(archived)).candidate as Record<string, unknown>).archived_at).toBeTruthy();

    const list = await listCandidates(new Request('http://localhost/api/candidates'));
    const rows = (await jsonBody(list)).candidates as Array<Record<string, unknown>>;
    expect(rows.some((c) => c.id === id)).toBe(false); // hidden by default

    const restored = await restoreCandidate(new Request('http://localhost/api/candidates/x/restore', { method: 'POST' }), { params: { id } });
    expect(restored.status).toBe(200);
    expect(((await jsonBody(restored)).candidate as Record<string, unknown>).archived_at).toBeNull();
  });

  it('soft-deletes and restores a candidate', async () => {
    const id = await create('Delete Me');
    const del = await deleteCandidate(new Request(`http://localhost/api/candidates/${id}`, { method: 'DELETE' }), { params: { id } });
    expect(del.status).toBe(200);
    expect((await jsonBody(del)).permanent).toBe(false);
    const gone = await getCandidate(new Request(`http://localhost/api/candidates/${id}`), { params: { id } });
    expect(gone.status).toBe(404);
    const restored = await restoreCandidate(new Request('http://localhost/api/candidates/x/restore', { method: 'POST' }), { params: { id } });
    expect(restored.status).toBe(200);
  });

  it('duplicates a candidate (copy, not default) and sets the default', async () => {
    const id = await create('Original');
    const dup = await duplicateCandidate(new Request('http://localhost/api/candidates/x/duplicate', { method: 'POST' }), { params: { id } });
    expect(dup.status).toBe(201);
    const copy = (await jsonBody(dup)).candidate as Record<string, unknown>;
    expect(copy.id).not.toBe(id);
    expect(copy.name).toContain('(copy)');
    expect(copy.is_default).toBe(false);

    const def = await setDefaultCandidate(new Request('http://localhost/api/candidates/x/set-default', { method: 'POST' }), { params: { id: copy.id as string } });
    expect(def.status).toBe(200);
    expect(((await jsonBody(def)).candidate as Record<string, unknown>).is_default).toBe(true);
    const orig = await getCandidate(new Request(`http://localhost/api/candidates/${id}`), { params: { id } });
    expect(((await jsonBody(orig)).candidate as Record<string, unknown>).is_default).toBe(false);
  });
});
