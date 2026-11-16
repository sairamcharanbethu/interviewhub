import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTempDir, jsonBody, jsonReq, makeTempDataDir } from '../helpers';
import { NAGA_RESUME } from '../fixtures';

const dir = makeTempDataDir();
afterAll(() => cleanupTempDir(dir));

const { POST: createCandidate } = await import('@/app/api/candidates/route');
const { POST: uploadResume } = await import('@/app/api/candidates/[id]/resumes/route');
const { POST: createApplication } = await import('@/app/api/applications/route');
const { POST: exportBackup } = await import('@/app/api/backup/export/route');
const { POST: restoreBackup } = await import('@/app/api/backup/restore/route');
const { GET: getAiSettings, POST: saveAiSettings } = await import('@/app/api/ai-settings/route');
const dbLib = await import('@/lib/db');

describe('backup export/restore round-trip', () => {
  it('exports and restores all data, including non-secret ai_settings', async () => {
    // Seed data.
    const c = await createCandidate(jsonReq('http://localhost/api/candidates', 'POST', { name: 'Naga Iswarya Lakshmi Bhogadi' }));
    const candidateId = ((await jsonBody(c)).candidate as Record<string, unknown>).id as string;
    const fd = new FormData();
    fd.append('file', new File([NAGA_RESUME], 'naga-resume.txt', { type: 'text/plain' }));
    await uploadResume(new Request(`http://localhost/api/candidates/${candidateId}/resumes`, { method: 'POST', body: fd }), { params: { id: candidateId } });
    const a = await createApplication(jsonReq('http://localhost/api/applications', 'POST', { candidate_id: candidateId, company: 'Harris Computer', title: 'Technical Consultant – Oracle DBA' }));
    const applicationId = ((await jsonBody(a)).application as Record<string, unknown>).id as string;

    // Set a distinctive AI-settings state (no key — a key must never round-trip).
    const saved = await saveAiSettings(jsonReq('http://localhost/api/ai-settings', 'POST', {
      openrouter_model: 'roundtrip-test-model', ollama_model: 'llama3.1-test',
      routing: { match: { provider: 'openrouter', model: 'roundtrip-test-model' } },
    }));
    expect(saved.status).toBe(200);

    const exp = await exportBackup();
    expect(exp.status).toBe(200);
    const backup = await jsonBody(exp);
    expect(backup.version).toBe(1);
    const tables = backup.tables as Record<string, Array<Record<string, unknown>>>;
    expect(tables.candidates.some((r) => r.id === candidateId)).toBe(true);
    expect(tables.applications.some((r) => r.id === applicationId)).toBe(true);
    expect(tables.document_chunks.length).toBeGreaterThan(0);
    // Export never contains the OpenRouter key.
    expect(JSON.stringify(tables.ai_settings)).not.toContain('openrouter_key');
    expect((tables.ai_settings[0] as Record<string, unknown>).openrouter_model).toBe('roundtrip-test-model');

    // Tamper: change settings, then restore a backup whose ai_settings row
    // smuggles a fake key — the key must NOT be restored.
    await saveAiSettings(jsonReq('http://localhost/api/ai-settings', 'POST', { openrouter_model: 'changed-model' }));
    const tampered = JSON.parse(JSON.stringify(backup)) as typeof backup;
    ((tampered.tables as Record<string, Array<Record<string, unknown>>>).ai_settings[0] as Record<string, unknown>).openrouter_key = 'sk-or-FAKEKEY-DO-NOT-RESTORE';
    const res = await restoreBackup(jsonReq('http://localhost/api/backup/restore', 'POST', tampered));
    expect(res.status).toBe(200);
    const counts = (await jsonBody(res)).counts as Record<string, number>;
    expect(counts.ai_settings).toBe(1);
    expect(counts.candidates).toBeGreaterThanOrEqual(1);

    const after = await getAiSettings();
    const settings = (await jsonBody(after)).ai_settings as Record<string, unknown>;
    expect(settings.openrouter_model).toBe('roundtrip-test-model');
    expect(settings.has_openrouter_key).toBe(false);
    const storedKey = dbLib.get<{ openrouter_key: string | null }>(`SELECT openrouter_key FROM ai_settings WHERE id = 1`);
    expect(storedKey?.openrouter_key).toBeNull();
    // Canonical routing round-tripped.
    expect((settings.routing as Record<string, Record<string, string>>).match).toEqual({ provider: 'openrouter', model: 'roundtrip-test-model' });
  });

  it('rejects an unknown table in restore', async () => {
    const res = await restoreBackup(jsonReq('http://localhost/api/backup/restore', 'POST', { version: 1, tables: { users: [{ id: 1 }] } }));
    expect(res.status).toBe(400);
  });
});
