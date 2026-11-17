import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { cleanupTempDir, makeTempDataDir, jsonBody } from '../helpers';
import { NAGA_RESUME, HARRIS_JD } from '../fixtures';

const dir = makeTempDataDir();
afterAll(() => cleanupTempDir(dir));

// Mock the provider registry: canned valid JSON for every extraction /
// insight / question / answer call. The mock returns one payload carrying
// every field any consumer reads, so no live provider is ever needed.
const CANNED = {
  fullName: 'Naga Iswarya Lakshmi Bhogadi',
  email: 'naga.bhogadi@example.com',
  phone: '(905) 555-0142',
  location: 'Mississauga, Ontario, Canada',
  headline: 'Oracle DBA | Cloud Database Engineer',
  summary: 'Oracle DBA with 4 years of experience.',
  totalYearsExperience: 4,
  employment: [{ employer: 'DXC Technology', position: 'Software Engineer', startDate: '2022-06', endDate: '2026-05', responsibilities: ['Administered Oracle 19c RAC'], achievements: ['Reduced recovery time by 35%'] }],
  skills: { technical: ['Oracle', 'Oracle RAC', 'RMAN', 'PL/SQL', 'SQL', 'AWS'], functional: [], tools: ['Git'] },
  certifications: ['Oracle Certified Associate (OCA)', 'Oracle Certified Professional (OCP)'],
  education: [{ institution: 'NRI Institute of Technology', credential: 'B.Tech Computer Science', field: 'Computer Science', year: '2023' }],
  projects: [],
  measurableAchievements: ['Reduced recovery time by 35%'],
  company: 'Harris Computer',
  title: 'Technical Consultant – Oracle DBA',
  department: null,
  employmentType: 'Full-time',
  seniority: null,
  requiredExperience: 3,
  mandatorySkills: ['Oracle RAC', 'Oracle Data Guard', 'RMAN'],
  preferredSkills: ['AWS', 'Exadata'],
  technologies: ['Oracle', 'RMAN', 'AWS'],
  responsibilities: ['Perform Oracle installations and upgrades'],
  domainKnowledge: [],
  leadershipExpectations: [],
  hiringCriteria: ['Oracle RAC'],
  interviewCategories: ['Technical', 'Behavioral'],
  assessments: [
    { requirement: 'Oracle', demonstrated: true, evidence: 'Oracle 19c RAC clusters (3 nodes)' },
    { requirement: 'Oracle RAC', demonstrated: true, evidence: 'Administered Oracle 19c RAC clusters' },
    { requirement: 'RMAN', demonstrated: true, evidence: 'RMAN backup and recovery strategy' },
  ],
  strongestQualifications: ['Oracle RAC administration', 'RMAN backup and recovery'],
  missingQualifications: ['Oracle Certified Professional (OCP)'],
  weaknesses: ['No OCP certification yet'],
  transferableSkills: ['Python scripting for automation'],
  prepRecommendations: ['Prepare a truthful answer about OCP'],
  requirementAssessments: [],
  questions: [
    { category: 'Introduction', question: 'Tell me about yourself and your background relevant to this role.', source: 'AI generated' },
    { category: 'Behavioral', question: 'Tell me about a time you faced a difficult technical problem. What did you do? (STAR)', source: 'AI generated' },
    { category: 'Technical', question: 'Explain how you would approach Oracle RAC in a production environment.', source: 'JD keyword: Oracle RAC' },
    { category: 'Technical', question: 'Walk me through RMAN backup and recovery for a production database.', source: 'JD keyword: RMAN' },
    { category: 'Company', question: 'What do you know about Harris Computer and why do you want to work here?', source: 'AI generated' },
  ],
  answers: [
    { question: 'Tell me about yourself and your background relevant to this role.', answer: 'I am an Oracle DBA with 4 years of experience administering Oracle 19c RAC.', evidence: ['Oracle 19c RAC clusters (3 nodes)'], gaps: [] },
    { question: 'Tell me about a time you faced a difficult technical problem. What did you do? (STAR)', answer: 'Situation: RAC cluster issue. Task: restore service. Action: tuned SQL with AWR. Result: query time cut from 4.2s to 0.9s.', evidence: ['Tuned slow SQL with AWR/ASH reports'], gaps: [] },
    { question: 'Explain how you would approach Oracle RAC in a production environment.', answer: 'Based on my resume evidence: administered Oracle 19c RAC clusters (3 nodes).', evidence: ['Oracle 19c RAC clusters'], gaps: [] },
    { question: 'Walk me through RMAN backup and recovery for a production database.', answer: 'Based on my resume evidence: implemented RMAN backup and recovery strategy.', evidence: ['RMAN backup and recovery strategy'], gaps: [] },
    { question: 'What do you know about Harris Computer and why do you want to work here?', answer: 'Not demonstrated — no company evidence on file yet.', evidence: [], gaps: ['No company research on file'] },
  ],
};

vi.mock('@/lib/ai/registry', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/ai/registry')>();
  return {
    ...orig,
    completeJsonWithFallback: vi.fn(async (prompt: string) => ({
      // The no-company/no-title JD used by the 'Unknown labels' test gets
      // null company/title from the "AI", so the job must label them Unknown.
      result: { data: typeof prompt === 'string' && prompt.includes('We need someone with Oracle') ? { ...CANNED, company: null, title: null } : CANNED, provider: 'openrouter', model: 'mock-model' },
      providerId: 'openrouter', model: 'mock-model', origin: 'ai', attempts: [],
    })),
    completeTextWithFallback: vi.fn(async () => ({
      result: { text: 'mock text', provider: 'openrouter', model: 'mock-model' },
      providerId: 'openrouter', model: 'mock-model', origin: 'ai', attempts: [],
    })),
  };
});

const { get, all, run } = await import('@/lib/db');
const { POST: preparePost } = await import('@/app/api/prepare/route');
const { GET: prepareGet } = await import('@/app/api/prepare/[jobId]/route');
const { POST: retryPost } = await import('@/app/api/prepare/[jobId]/retry/route');
const { processJob } = await import('@/lib/prepare/runner');
const { setConfirmedNativelyDir } = await import('@/lib/natively-install');
const { retrieveContext } = await import('@/lib/rag');

const nativelyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-natively-'));

beforeEach(() => {
  run(`UPDATE ai_settings SET openrouter_key = NULL, ollama_base_url = 'http://127.0.0.1:9' WHERE id = 1`);
  process.env.NATIVELY_SKILLS_DIR = nativelyDir;
  setConfirmedNativelyDir(nativelyDir);
});

function prepareForm(resumeText: string, jdText: string, resumeName = 'naga-resume.txt'): FormData {
  const fd = new FormData();
  fd.append('resume', new File([resumeText], resumeName, { type: 'text/plain' }));
  fd.append('jd_text', jdText);
  return fd;
}

async function runJob(resumeText: string, jdText: string, resumeName = 'naga-resume.txt') {
  const res = await preparePost(new Request('http://localhost/api/prepare', { method: 'POST', body: prepareForm(resumeText, jdText, resumeName) }));
  const body = await jsonBody(res);
  expect(res.status).toBe(202);
  const jobId = body.jobId as string;
  const { getJob } = await import('@/lib/prepare/job');
  const job = getJob(jobId)!;
  const done = await processJob(job);
  return { jobId, done, body };
}

describe('POST /api/prepare — full job flow (mocked AI)', () => {
  it('completes end to end: candidate, resume selected, application, match, questions, STAR drafts, Skill installed', async () => {
    const { jobId, done } = await runJob(NAGA_RESUME, HARRIS_JD);
    expect(done.status).toBe('completed');
    expect(done.candidate_id).toBeTruthy();
    expect(done.application_id).toBeTruthy();
    const candidate = get<Record<string, unknown>>(`SELECT * FROM candidates WHERE id = ?`, done.candidate_id!);
    expect(candidate!.name).toBe('Naga Iswarya Lakshmi Bhogadi');
    expect((candidate!.email as string).toLowerCase()).toBe('naga.bhogadi@example.com');
    const resumes = all<Record<string, unknown>>(`SELECT * FROM resumes WHERE candidate_id = ?`, done.candidate_id!);
    expect(resumes.length).toBe(1);
    expect(resumes[0].is_active).toBe(1);
    const app = get<Record<string, unknown>>(`SELECT * FROM applications WHERE id = ?`, done.application_id!);
    expect(app!.company).toBe('Harris Computer');
    expect(app!.title).toBe('Technical Consultant – Oracle DBA');
    expect(app!.selected_resume_id).toBe(resumes[0].id);
    // Match score recorded on the role_insight stage.
    const insight = done.stage_results.role_insight;
    expect(insight?.status).toBe('completed');
    expect((insight?.detail as Record<string, unknown>)?.overallScore).toBeGreaterThanOrEqual(0);
    // Questions + session persisted.
    const sessions = all<Record<string, unknown>>(`SELECT * FROM interview_sessions WHERE application_id = ?`, done.application_id!);
    expect(sessions.length).toBe(1);
    const questions = JSON.parse(sessions[0].questions as string) as Array<Record<string, unknown>>;
    expect(questions.length).toBeGreaterThanOrEqual(5);
    // STAR drafts are unverified by construction.
    const stars = all<Record<string, unknown>>(`SELECT * FROM star_stories WHERE candidate_id = ?`, done.candidate_id!);
    expect(stars.length).toBeGreaterThan(0);
    expect(stars.every((s) => s.verification_status === 'draft')).toBe(true);
    // Skill generated + installed into the temp Natively dir.
    const install = done.stage_results.installing_natively;
    expect(install?.status).toBe('completed');
    const slug = (install?.detail as Record<string, unknown>)?.slug as string;
    expect(fs.existsSync(path.join(nativelyDir, slug, 'SKILL.md'))).toBe(true);
    const skillText = fs.readFileSync(path.join(nativelyDir, slug, 'SKILL.md'), 'utf8');
    expect(skillText).toContain('Naga Iswarya Lakshmi Bhogadi');
    expect(skillText).toContain('Harris Computer');
    // GET endpoint reports the same job.
    const getRes = await prepareGet(new Request('http://localhost/api/prepare/x'), { params: { jobId } });
    const getBody = await jsonBody(getRes);
    expect(getBody.status).toBe('completed');
    expect(getBody.candidateId).toBe(done.candidate_id);
  });

  it('reuses a candidate on exact email match and adds a new resume version', async () => {
    const first = await runJob(NAGA_RESUME, HARRIS_JD);
    expect(first.done.status).toBe('completed');
    const second = await runJob(NAGA_RESUME, HARRIS_JD.replace('Harris Computer', 'Harris Computer'));
    // Same resume bytes + same JD text = same idempotency key → same job.
    expect(second.jobId).toBe(first.jobId);
    // A different JD gives a new job but the same candidate.
    const third = await runJob(NAGA_RESUME, `${HARRIS_JD}\n\nAdditional note: on-call rotation required.`);
    expect(third.done.candidate_id).toBe(first.done.candidate_id);
    const resumes = all<Record<string, unknown>>(`SELECT * FROM resumes WHERE candidate_id = ? ORDER BY version ASC`, first.done.candidate_id!);
    expect(resumes.length).toBe(2);
    expect(resumes[1].version).toBe(2);
  });

  it('creates a candidate when the resume has no email', async () => {
    const noEmail = NAGA_RESUME.replace('naga.bhogadi@example.com | ', '');
    const { done } = await runJob(noEmail, HARRIS_JD);
    expect(done.status).toBe('completed');
    expect(done.candidate_id).toBeTruthy();
    const candidate = get<Record<string, unknown>>(`SELECT * FROM candidates WHERE id = ?`, done.candidate_id!);
    expect(candidate!.name).toBe('Naga Iswarya Lakshmi Bhogadi');
  });

  it('flags duplicates without merging and does not stop the job', async () => {
    // Two pre-existing candidates with the same normalized email.
    const { newId, now } = await import('@/lib/db');
    for (let i = 0; i < 2; i++) {
      run(`INSERT INTO candidates (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        newId('cand_'), `Dup ${i}`, 'NAGA.BHOGADI@EXAMPLE.COM', now(), now());
    }
    const { done } = await runJob(NAGA_RESUME, `${HARRIS_JD}\n\nNote: this posting is for the duplicate-handling check.`);
    expect(done.status).toBe('completed');
    const flags = done.duplicate_flags as { duplicate_candidate_ids: string[] } | null;
    expect(flags?.duplicate_candidate_ids.length).toBeGreaterThanOrEqual(2);
    // A fresh candidate was created (not merged into either duplicate).
    expect(done.candidate_id).toBeTruthy();
    const cand = get<Record<string, unknown>>(`SELECT * FROM candidates WHERE id = ?`, done.candidate_id!);
    expect(cand!.name).toBe('Naga Iswarya Lakshmi Bhogadi');
  });

  it('uses Unknown labels when company/title are missing', async () => {
    const jd = 'We need someone with Oracle and RMAN experience. 3+ years required.';
    const { done } = await runJob(NAGA_RESUME, jd);
    expect(done.status).toBe('completed');
    const app = get<Record<string, unknown>>(`SELECT * FROM applications WHERE id = ?`, done.application_id!);
    expect(app!.company).toBe('Unknown');
    expect(app!.title).toBe('Unknown');
  });

  it('completes as partial when the Natively directory is not confirmed', async () => {
    run(`UPDATE ai_settings SET confirmed_natively_dir = NULL, confirmed_natively_at = NULL WHERE id = 1`);
    const { done } = await runJob(NAGA_RESUME, `${HARRIS_JD}\n\nNote: this posting is for the unconfirmed-directory check.`);
    expect(done.status).toBe('partial');
    expect(done.stage_results.installing_natively?.status).toBe('failed');
    expect(done.stage_results.installing_natively?.error).toMatch(/not confirmed/);
    // The Skill file itself was still built.
    expect(done.stage_results.building_skill?.status).toBe('completed');
    // Retry after confirming installs without duplicating the candidate.
    setConfirmedNativelyDir(nativelyDir);
    const retryRes = await retryPost(new Request('http://localhost/api/prepare/x/retry', { method: 'POST' }), { params: { jobId: done.id } });
    expect(retryRes.status).toBe(200);
    const { getJob } = await import('@/lib/prepare/job');
    const retried = await processJob(getJob(done.id)!);
    expect(retried.status).toBe('completed');
    const apps = all<Record<string, unknown>>(`SELECT * FROM applications WHERE candidate_id = ?`, retried.candidate_id!);
    expect(apps.length).toBe(1);
    const sessions = all<Record<string, unknown>>(`SELECT * FROM interview_sessions WHERE application_id = ?`, retried.application_id!);
    expect(sessions.length).toBe(1);
  });

  it('rejects a JD URL that cannot be fetched', async () => {
    const fd = new FormData();
    fd.append('resume', new File([NAGA_RESUME], 'naga-resume.txt', { type: 'text/plain' }));
    fd.append('jd_url', 'https://127.0.0.1:9/jobs/123');
    const res = await preparePost(new Request('http://localhost/api/prepare', { method: 'POST', body: fd }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await jsonBody(res);
    expect(String(body.error || '')).toBeTruthy();
  });

  it('rejects a resume with bad magic bytes', async () => {
    const fd = new FormData();
    fd.append('resume', new File(['not a pdf at all'], 'fake.pdf', { type: 'application/pdf' }));
    fd.append('jd_text', HARRIS_JD);
    const res = await preparePost(new Request('http://localhost/api/prepare', { method: 'POST', body: fd }));
    expect(res.status).toBe(400);
  });

  it('keeps two candidates isolated in RAG retrieval', async () => {
    const first = await runJob(NAGA_RESUME, HARRIS_JD);
    const otherResume = `John Smith\nPython Developer\nToronto, Canada | john.smith@example.com\n\nSKILLS\nPython, Django, Flask\n\nEMPLOYMENT\nDeveloper, Acme Corp — 2020-01 to 2024-01\n- Built Django APIs.\n`;
    const otherJd = 'Python Developer\nAcme Corp — Toronto\nRequired: Python, Django, Flask.';
    const second = await runJob(otherResume, otherJd);
    expect(second.done.candidate_id).not.toBe(first.done.candidate_id);
    const { chunks } = retrieveContext({ candidateId: first.done.candidate_id!, query: 'Django Flask Python', limit: 10 });
    expect(chunks.every((c) => c.candidate_id === first.done.candidate_id)).toBe(true);
    expect(chunks.some((c) => /Django/i.test(c.chunk_text))).toBe(false);
  });
});

describe('malformed AI JSON falls back to heuristics (mocked registry failure)', () => {
  it('extract falls back and labels origin fallback', async () => {
    const registry = await import('@/lib/ai/registry');
    const mock = registry.completeJsonWithFallback as unknown as { mockImplementationOnce: (fn: () => Promise<unknown>) => void };
    // One failing call (extraction) then canned success for the rest.
    mock.mockImplementationOnce(async () => ({ result: null, providerId: 'fallback', model: null, origin: 'fallback', attempts: [{ provider: 'openrouter', kind: 'unavailable', message: 'down' }] }));
    const { extractCandidateProfile } = await import('@/lib/ai/extract');
    const out = await extractCandidateProfile(NAGA_RESUME);
    expect(out.origin).toBe('fallback');
    expect(out.data.fullName).toBe('Naga Iswarya Lakshmi Bhogadi');
  });
});
