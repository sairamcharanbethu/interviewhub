import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTempDir, makeTempDataDir } from '../helpers';

const dir = makeTempDataDir();
let ctxLib: typeof import('@/lib/context');
let dbLib: typeof import('@/lib/db');

beforeAll(async () => {
  ctxLib = await import('@/lib/context');
  dbLib = await import('@/lib/db');
  dbLib.run(`INSERT INTO candidates (id, name, created_at, updated_at) VALUES ('cand_A', 'Candidate A', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`);
  dbLib.run(`INSERT INTO candidates (id, name, created_at, updated_at) VALUES ('cand_B', 'Candidate B', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`);
  // Two resumes for A: v1 inactive, v2 active.
  dbLib.run(`INSERT INTO resumes (id, candidate_id, filename, stored_path, version, is_active, created_at) VALUES ('resume_A1', 'cand_A', 'a1.txt', 'uploads/cand_A/a1.txt', 1, 0, '2026-01-01 00:00:00')`);
  dbLib.run(`INSERT INTO resumes (id, candidate_id, filename, stored_path, version, is_active, created_at) VALUES ('resume_A2', 'cand_A', 'a2.txt', 'uploads/cand_A/a2.txt', 2, 1, '2026-01-01 00:00:00')`);
  dbLib.run(`INSERT INTO resumes (id, candidate_id, filename, stored_path, version, is_active, created_at) VALUES ('resume_B1', 'cand_B', 'b1.txt', 'uploads/cand_B/b1.txt', 1, 1, '2026-01-01 00:00:00')`);
  dbLib.run(`INSERT INTO applications (id, candidate_id, company, title, selected_resume_id, created_at, updated_at) VALUES ('app_A1', 'cand_A', 'A Corp', 'DBA', 'resume_A1', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`);
  dbLib.run(`INSERT INTO applications (id, candidate_id, company, title, created_at, updated_at) VALUES ('app_A2', 'cand_A', 'A Corp', 'DBA', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`);
  dbLib.run(`INSERT INTO applications (id, candidate_id, company, title, selected_resume_id, created_at, updated_at) VALUES ('app_Abad', 'cand_A', 'A Corp', 'DBA', 'resume_B1', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`);
  // NOTE: no app_Agone row — applications.selected_resume_id is a real FK,
  // so a dangling selection cannot be inserted. The "selection no longer
  // exists" case is exercised below with a plain row object (defence for
  // legacy data / FK-off databases), which is the only way it can arise.
});

afterAll(() => cleanupTempDir(dir));

function appRow(id: string) {
  return dbLib.get<Record<string, unknown>>(`SELECT * FROM applications WHERE id = ?`, id)!;
}

describe('resolveResumeForApplication', () => {
  it('uses the application-selected resume, not the active one', () => {
    const r = ctxLib.resolveResumeForApplication(appRow('app_A1'));
    expect(r.resume?.id).toBe('resume_A1');
    expect(r.source).toBe('selected');
  });

  it('falls back to the active resume only when nothing is selected', () => {
    const r = ctxLib.resolveResumeForApplication(appRow('app_A2'));
    expect(r.resume?.id).toBe('resume_A2');
    expect(r.source).toBe('active');
  });

  it('rejects a selection that belongs to another candidate', () => {
    expect(() => ctxLib.resolveResumeForApplication(appRow('app_Abad'))).toThrow(/different candidate/);
  });

  it('rejects a selection that no longer exists instead of silently substituting', () => {
    expect(() =>
      ctxLib.resolveResumeForApplication({ candidate_id: 'cand_A', selected_resume_id: 'resume_missing' }),
    ).toThrow(/no longer exists/);
  });

  it('an explicit resume_id override is validated the same way', () => {
    const ok = ctxLib.resolveResumeForApplication(appRow('app_A2'), 'resume_A1');
    expect(ok.resume?.id).toBe('resume_A1');
    expect(() => ctxLib.resolveResumeForApplication(appRow('app_A2'), 'resume_B1')).toThrow(/different candidate/);
  });

  it('returns null (not a wrong resume) when the candidate has no resumes', () => {
    dbLib.run(`INSERT INTO applications (id, candidate_id, company, title, created_at, updated_at) VALUES ('app_B0', 'cand_B', 'B Corp', 'DBA', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`);
    dbLib.run(`DELETE FROM resumes WHERE id = 'resume_B1'`);
    const r = ctxLib.resolveResumeForApplication(appRow('app_B0'));
    expect(r.resume).toBeNull();
    expect(r.source).toBe('none');
  });
});
