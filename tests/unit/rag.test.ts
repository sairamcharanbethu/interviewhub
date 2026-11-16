import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTempDir, makeTempDataDir } from '../helpers';

const dir = makeTempDataDir();
let rag: typeof import('@/lib/rag');
let dbLib: typeof import('@/lib/db');

beforeAll(async () => {
  rag = await import('@/lib/rag');
  dbLib = await import('@/lib/db');
  // Candidates must exist: document_chunks.candidate_id is a real FK, and
  // resume_id / application_id are FKs too.
  for (const [id, name] of [['cand_A', 'Candidate A'], ['cand_B', 'Candidate B']] as const) {
    dbLib.run(`INSERT INTO candidates (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`, id, name, '2026-01-01 00:00:00', '2026-01-01 00:00:00');
  }
  dbLib.run(`INSERT INTO resumes (id, candidate_id, filename, stored_path, created_at) VALUES ('resume_A', 'cand_A', 'a.txt', 'uploads/cand_A/a.txt', '2026-01-01 00:00:00')`);
  dbLib.run(`INSERT INTO resumes (id, candidate_id, filename, stored_path, created_at) VALUES ('resume_B', 'cand_B', 'b.txt', 'uploads/cand_B/b.txt', '2026-01-01 00:00:00')`);
  dbLib.run(`INSERT INTO applications (id, candidate_id, company, title, created_at, updated_at) VALUES ('app_A', 'cand_A', 'A Corp', 'DBA', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`);
  dbLib.run(`INSERT INTO applications (id, candidate_id, company, title, created_at, updated_at) VALUES ('app_B', 'cand_A', 'B Corp', 'DBA', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`);
});

afterAll(() => cleanupTempDir(dir));

describe('RAG isolation', () => {
  it('never returns candidate A chunks when retrieving for candidate B', () => {
    rag.storeDocumentChunks('quokka-rac-failover: administered Oracle RAC clusters with Data Guard switchover drills.', { candidateId: 'cand_A', resumeId: 'resume_A', sourceType: 'resume' });
    rag.storeDocumentChunks('zebra-dataguard-tablespace: managed Oracle Data Guard and tablespace growth.', { candidateId: 'cand_B', resumeId: 'resume_B', sourceType: 'resume' });

    const forB = rag.retrieveContext({ candidateId: 'cand_B', query: 'quokka-rac-failover', limit: 8 });
    expect(forB.chunks.every((c) => c.candidate_id === 'cand_B')).toBe(true);
    expect(forB.chunks.some((c) => c.chunk_text.includes('quokka'))).toBe(false);
    expect(forB.has_evidence).toBe(false);

    const forA = rag.retrieveContext({ candidateId: 'cand_A', query: 'quokka-rac-failover', limit: 8 });
    expect(forA.has_evidence).toBe(true);
    expect(forA.chunks.length).toBeGreaterThan(0);
    expect(forA.chunks.every((c) => c.candidate_id === 'cand_A')).toBe(true);
  });

  it('returns an explicit no-evidence message when nothing matches', () => {
    const r = rag.retrieveContext({ candidateId: 'cand_B', query: 'definitely-not-in-any-document-xyz', limit: 8 });
    expect(r.chunks).toEqual([]);
    expect(r.has_evidence).toBe(false);
    expect(r.no_evidence_message).toMatch(/No evidence/i);
  });

  it('refuses retrieval without a candidate scope', () => {
    const r = rag.retrieveContext({ candidateId: '', query: 'quokka', limit: 8 });
    expect(r.chunks).toEqual([]);
    expect(r.has_evidence).toBe(false);
  });

  it('scopes JD chunks to their application when applicationId is given', () => {
    rag.storeDocumentChunks('quokka-jd-secret: JD for application app_A mentions quokka-jd-secret.', { candidateId: 'cand_A', applicationId: 'app_A', sourceType: 'jd' });
    rag.storeDocumentChunks('quokka-jd-other: JD for application app_B mentions quokka-jd-other.', { candidateId: 'cand_A', applicationId: 'app_B', sourceType: 'jd' });
    const r = rag.retrieveContext({ candidateId: 'cand_A', applicationId: 'app_A', query: 'quokka-jd', limit: 8 });
    expect(r.chunks.every((c) => c.application_id === null || c.application_id === 'app_A')).toBe(true);
    expect(r.chunks.some((c) => c.chunk_text.includes('quokka-jd-other'))).toBe(false);
  });
});
