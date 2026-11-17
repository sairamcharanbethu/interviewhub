// Background orchestrator for the one-click Prepare Interview job.
// One job at a time, sequential loop; SQLite claim prevents duplicate
// workers. Stages 1–3 failing fail the job; stages 4–9 failing mark the
// job 'partial' with clear messages. Each stage is skipped when already
// completed in stage_results (idempotent retry). Progress advances only
// while the Next.js server runs (local-first constraint — see ARCHITECTURE.md).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { get, run, newId, now, parseJson } from '../db';
import { dataDir } from '../db';
import { saveUpload } from '../files';
import { validateUploadBytes } from '../security';
import { extractTextByMime, parseResume } from '../parse/resume';
import { parseJD } from '../parse/jd';
import { fetchUrlText } from '../parse/fetch-url';
import { storeDocumentChunks, retrieveContext } from '../rag';
import { extractCandidateProfile, extractJobAnalysis, type CandidateProfile, type JobAnalysis } from '../ai/extract';
import { reuseOrCreateCandidate } from './candidate';
import { getCompanyDossier, companyResearchInstructions, type CompanyDossier } from '../company';
import { buildPrepPackage, persistPrepPackage, buildPrepSkillSections, buildRoleInsight, type PrepPackage } from './prep-package';
import { createJob, getJob, claimNextJob, updateJob, updateStage, completeJob, failJob, type PrepJob, type StageResult } from './job';
import { prepareSkillContent, writeSkillFile, getLatestSync } from '../natively';
import { installPrebuiltSkill } from '../natively-install';
import { getConfirmedNativelyDir } from '../natively-install';
import { MAX_SKILL_FILE_BYTES } from '../natively-install';

export const STAGE_LABELS: Record<string, string> = {
  reading_resume: 'Reading resume',
  building_profile: 'Building candidate profile',
  analyzing_jd: 'Analyzing job requirements',
  role_insight: 'Analyzing role fit',
  questions_answers: 'Preparing interview questions and answers',
  star_study: 'Building STAR stories and study guide',
  company_research: 'Researching the company',
  building_skill: 'Building Natively Skill',
  installing_natively: 'Installing into Natively',
  ready: 'Ready',
};
export const STAGE_ORDER = ['reading_resume', 'building_profile', 'analyzing_jd', 'role_insight', 'questions_answers', 'star_study', 'company_research', 'building_skill', 'installing_natively', 'ready'];
export const STAGE_PROGRESS: Record<string, number> = {
  reading_resume: 5, building_profile: 20, analyzing_jd: 35, role_insight: 45,
  questions_answers: 60, star_study: 70, company_research: 78, building_skill: 88,
  installing_natively: 95, ready: 100,
};

export interface PrepareInputs {
  resumeFilename: string;
  resumeMime: string;
  resumeStoredPath: string; // relative under DATA_DIR, staged upload
  jdText: string | null;
  jdUrl: string | null;
  jdFilename: string | null;
  jdFileStoredPath: string | null;
  resumeText?: string;
  profile?: CandidateProfile;
  jobAnalysis?: JobAnalysis;
}

function inputsDir(): string {
  const d = path.join(dataDir(), 'prepare-inputs');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
export function savePrepareInputs(jobId: string, inputs: PrepareInputs): void {
  fs.writeFileSync(path.join(inputsDir(), `${jobId}.json`), JSON.stringify(inputs), 'utf8');
}
export function loadPrepareInputs(jobId: string): PrepareInputs | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(inputsDir(), `${jobId}.json`), 'utf8')) as PrepareInputs;
  } catch { return null; }
}
function persistInputs(jobId: string, inputs: PrepareInputs): void { savePrepareInputs(jobId, inputs); }

function stageDone(job: PrepJob, stage: string): boolean {
  return job.stage_results[stage]?.status === 'completed';
}
function markStage(jobId: string, stage: string, result: StageResult, progress?: number): void {
  updateStage(jobId, stage, result);
  if (progress !== undefined) updateJob(jobId, { current_stage: stage, progress });
}

const WORKER_ID = `worker-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
let workerRunning = false;
let workerPromise: Promise<void> | null = null;

export function isWorkerRunning(): boolean { return workerRunning; }

export async function processJob(job: PrepJob): Promise<PrepJob> {
  const jobId = job.id;
  const inputs = loadPrepareInputs(jobId);
  if (!inputs) {
    failJob(jobId, { stage: 'reading_resume', message: 'Job inputs not found (server restarted before inputs were staged?)' });
    return getJob(jobId)!;
  }
  let current = getJob(jobId)!;
  const refresh = () => { current = getJob(jobId)!; return current; };
  const origins: Record<string, 'ai' | 'fallback'> = { ...((current.origin_summary || {}) as Record<string, 'ai' | 'fallback'>) };
  let partial = false;
  const errors: Record<string, string> = {};
  const notePartial = (stage: string, msg: string) => { partial = true; errors[stage] = msg; };

  let resumeText = inputs.resumeText || '';
  let profile: CandidateProfile | undefined = inputs.profile;
  let jobAnalysis: JobAnalysis | undefined = inputs.jobAnalysis;
  let candidateId = current.candidate_id;
  let applicationId = current.application_id;
  let resumeId: string | null = null;
  let pkg: PrepPackage | null = null;
  let dossier: CompanyDossier | null = null;

  const failStage = (stage: string, e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    markStage(jobId, stage, { status: 'failed', error: msg });
    return msg;
  };

  try {
    // ---- Stage 1: reading_resume (critical)
    if (!stageDone(current, 'reading_resume')) {
      updateJob(jobId, { current_stage: 'reading_resume', progress: STAGE_PROGRESS.reading_resume });
      try {
        const abs = path.join(dataDir(), inputs.resumeStoredPath);
        const bytes = fs.readFileSync(abs);
        const v = validateUploadBytes(inputs.resumeFilename, bytes, inputs.resumeMime);
        if (!v.ok) throw new Error(v.error);
        resumeText = await extractTextByMime(bytes, inputs.resumeMime, inputs.resumeFilename);
        if (!resumeText.trim()) throw new Error('No readable text found in the resume file');
        inputs.resumeText = resumeText;
        persistInputs(jobId, inputs);
        markStage(jobId, 'reading_resume', { status: 'completed', origin: 'fallback' }, STAGE_PROGRESS.reading_resume);
      } catch (e) { failJob(jobId, { stage: 'reading_resume', message: failStage('reading_resume', e) }); return getJob(jobId)!; }
    } else { resumeText = inputs.resumeText || ''; }
    current = refresh();

    // ---- Stage 2: building_profile (critical)
    if (!stageDone(current, 'building_profile')) {
      updateJob(jobId, { current_stage: 'building_profile', progress: STAGE_PROGRESS.building_profile });
      try {
        const extracted = await extractCandidateProfile(resumeText);
        profile = extracted.data;
        origins.profile = extracted.origin;
        const reuse = reuseOrCreateCandidate(profile);
        candidateId = reuse.candidateId;
        updateJob(jobId, { candidate_id: candidateId, duplicate_flags: reuse.duplicateCandidateIds.length ? { duplicate_candidate_ids: reuse.duplicateCandidateIds } : null });
        // Save resume as a new version for this candidate.
        const prev = get<{ maxv: number | null }>(`SELECT MAX(version) AS maxv FROM resumes WHERE candidate_id = ?`, candidateId);
        const version = (prev?.maxv ?? 0) + 1;
        run(`UPDATE resumes SET is_active = 0 WHERE candidate_id = ?`, candidateId);
        const abs = path.join(dataDir(), inputs.resumeStoredPath);
        const bytes = fs.readFileSync(abs);
        const { storedPath } = await saveUpload(candidateId, inputs.resumeFilename, bytes);
        const parsed = parseResume(resumeText);
        const rid = newId('res_');
        run(
          `INSERT INTO resumes (id, candidate_id, filename, stored_path, mime, size_bytes, version, extracted_text, parsed, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          rid, candidateId, inputs.resumeFilename, storedPath, inputs.resumeMime || null, bytes.length, version, resumeText, JSON.stringify(parsed),
        );
        resumeId = rid;
        storeDocumentChunks(resumeText, { candidateId, resumeId: rid, sourceType: 'resume' });
        inputs.profile = profile;
        persistInputs(jobId, inputs);
        markStage(jobId, 'building_profile', { status: 'completed', origin: extracted.origin, detail: { candidateId, reused: reuse.reused, resumeId: rid, duplicateCandidateIds: reuse.duplicateCandidateIds } }, STAGE_PROGRESS.building_profile);
      } catch (e) { failJob(jobId, { stage: 'building_profile', message: failStage('building_profile', e) }); return getJob(jobId)!; }
    } else {
      profile = inputs.profile;
      candidateId = current.candidate_id;
      const r = get<{ id: string }>(`SELECT id FROM resumes WHERE candidate_id = ? AND is_active = 1 ORDER BY version DESC LIMIT 1`, candidateId);
      resumeId = r?.id ?? null;
    }
    current = refresh();
    if (!candidateId || !profile) { failJob(jobId, { stage: 'building_profile', message: 'Candidate/profile missing after stage 2' }); return getJob(jobId)!; }

    // ---- Stage 3: analyzing_jd (critical)
    if (!stageDone(current, 'analyzing_jd')) {
      updateJob(jobId, { current_stage: 'analyzing_jd', progress: STAGE_PROGRESS.analyzing_jd });
      try {
        let jdText = inputs.jdText || '';
        if (!jdText && inputs.jdUrl) jdText = await fetchUrlText(inputs.jdUrl);
        if (!jdText && inputs.jdFileStoredPath) {
          const bytes = fs.readFileSync(path.join(dataDir(), inputs.jdFileStoredPath));
          jdText = await extractTextByMime(bytes, 'text/plain', inputs.jdFilename || 'jd.txt');
        }
        if (!jdText.trim()) throw new Error('No job description provided — paste JD text, a JD URL, or upload a JD file');
        const extracted = await extractJobAnalysis(jdText);
        jobAnalysis = extracted.data;
        origins.jd = extracted.origin;
        inputs.jdText = jdText;
        inputs.jobAnalysis = jobAnalysis;
        persistInputs(jobId, inputs);
        const company = jobAnalysis.company || 'Unknown';
        const title = jobAnalysis.title || 'Unknown';
        if (!applicationId) {
          const appId = newId('app_');
          const ts = now();
          const jdParsed = parseJD(jdText);
          run(
            `INSERT INTO applications (id, candidate_id, company, title, department, location, employment_type, job_url, recruiter, application_date, status, interview_date, stage, jd_text, jd_parsed, company_notes, notes, selected_resume_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            appId, candidateId, company, title, jobAnalysis.department ?? null, jobAnalysis.location ?? null,
            jobAnalysis.employmentType ?? null, inputs.jdUrl ?? null, null, null, 'applied', null, null,
            jdText, JSON.stringify(jdParsed), null, null, resumeId, ts, ts,
          );
          applicationId = appId;
          updateJob(jobId, { application_id: applicationId });
        }
        storeDocumentChunks(jdText, { candidateId, applicationId, sourceType: 'jd' });
        markStage(jobId, 'analyzing_jd', { status: 'completed', origin: extracted.origin, detail: { applicationId, company, title } }, STAGE_PROGRESS.analyzing_jd);
      } catch (e) { failJob(jobId, { stage: 'analyzing_jd', message: failStage('analyzing_jd', e) }); return getJob(jobId)!; }
    } else {
      jobAnalysis = inputs.jobAnalysis;
      applicationId = current.application_id;
    }
    current = refresh();
    if (!applicationId || !jobAnalysis) { failJob(jobId, { stage: 'analyzing_jd', message: 'Application/JD missing after stage 3' }); return getJob(jobId)!; }

    // ---- Stage 4: role_insight (non-critical)
    if (!stageDone(current, 'role_insight')) {
      updateJob(jobId, { current_stage: 'role_insight', progress: STAGE_PROGRESS.role_insight });
      try {
        const chunks = retrieveContext({ candidateId, applicationId, resumeId, query: (inputs.jdText || '').slice(0, 500) || 'experience skills', limit: 12 }).chunks;
        const parsed = parseJson<Record<string, unknown>>((get<{ parsed: string }>(`SELECT parsed FROM resumes WHERE id = ?`, resumeId)?.parsed as string) || null, {});
        const { insight } = await buildRoleInsight(resumeText, { ...parsed, total_experience_years: profile.totalYearsExperience }, inputs.jdText || '', null, chunks);
        origins.role_insight = insight.origin;
        markStage(jobId, 'role_insight', { status: 'completed', origin: insight.origin, detail: { overallScore: insight.overallScore, deterministicScore: insight.deterministicScore } }, STAGE_PROGRESS.role_insight);
      } catch (e) { notePartial('role_insight', failStage('role_insight', e)); }
    }
    current = refresh();

    // ---- Stage 5: questions_answers (non-critical)
    if (!stageDone(current, 'questions_answers')) {
      updateJob(jobId, { current_stage: 'questions_answers', progress: STAGE_PROGRESS.questions_answers });
      try {
        const chunks = retrieveContext({ candidateId, applicationId, resumeId, query: (inputs.jdText || '').slice(0, 500) || 'experience skills', limit: 12 }).chunks;
        pkg = await buildPrepPackage(candidateId, applicationId, profile, jobAnalysis, resumeText, inputs.jdText || '', chunks);
        Object.assign(origins, pkg.originSummary);
        markStage(jobId, 'questions_answers', { status: 'completed', origin: pkg.originSummary.questions, detail: { questionCount: pkg.questions.length, answerCount: pkg.answers.length } }, STAGE_PROGRESS.questions_answers);
      } catch (e) { notePartial('questions_answers', failStage('questions_answers', e)); }
    }
    current = refresh();

    // ---- Stage 6: star_study (non-critical; needs pkg — rebuild cheaply if stage 5 was skipped as done)
    if (!stageDone(current, 'star_study')) {
      updateJob(jobId, { current_stage: 'star_study', progress: STAGE_PROGRESS.star_study });
      try {
        if (!pkg) {
          const chunks = retrieveContext({ candidateId, applicationId, resumeId, query: (inputs.jdText || '').slice(0, 500) || 'experience skills', limit: 12 }).chunks;
          pkg = await buildPrepPackage(candidateId, applicationId, profile, jobAnalysis, resumeText, inputs.jdText || '', chunks);
          Object.assign(origins, pkg.originSummary);
        }
        const persisted = persistPrepPackage(candidateId, applicationId, pkg);
        markStage(jobId, 'star_study', { status: 'completed', origin: 'fallback', detail: { sessionId: persisted.sessionId, starDrafts: persisted.starIds.length } }, STAGE_PROGRESS.star_study);
      } catch (e) { notePartial('star_study', failStage('star_study', e)); }
    }
    current = refresh();

    // ---- Stage 7: company_research (non-blocking)
    if (!stageDone(current, 'company_research')) {
      updateJob(jobId, { current_stage: 'company_research', progress: STAGE_PROGRESS.company_research });
      try {
        dossier = await getCompanyDossier(jobAnalysis.company || 'Unknown', jobAnalysis.title || '');
        origins.company_research = dossier.available ? 'ai' : 'fallback';
        markStage(jobId, 'company_research', { status: 'completed', origin: origins.company_research, detail: { available: dossier.available, fromCache: dossier.fromCache, error: dossier.error } }, STAGE_PROGRESS.company_research);
      } catch (e) { notePartial('company_research', failStage('company_research', e)); }
    }
    current = refresh();

    // ---- Stage 8: building_skill (non-critical)
    let skillContent: string | null = null;
    if (!stageDone(current, 'building_skill')) {
      updateJob(jobId, { current_stage: 'building_skill', progress: STAGE_PROGRESS.building_skill });
      try {
        if (!pkg) {
          const chunks = retrieveContext({ candidateId, applicationId, resumeId, query: (inputs.jdText || '').slice(0, 500) || 'experience skills', limit: 12 }).chunks;
          pkg = await buildPrepPackage(candidateId, applicationId, profile, jobAnalysis, resumeText, inputs.jdText || '', chunks);
        }
        if (!dossier) dossier = await getCompanyDossier(jobAnalysis.company || 'Unknown', jobAnalysis.title || '');
        const prepared = prepareSkillContent(applicationId, resumeId);
        const { text: extra } = buildPrepSkillSections(pkg, dossier, []);
        let content = prepared.built.content + extra;
        // Enforce Natively's 100 KiB cap: drop lowest-priority extra sections
        // first (study guide, then answers), record omitted sections honestly.
        const omittedSections: string[] = [];
        const sectionTitles = ['Natural conversational delivery', 'Unsupported-question handling', 'Company preparation', 'Study guidance', 'Suggested answers + evidence'];
        while (Buffer.byteLength(content, 'utf8') > MAX_SKILL_FILE_BYTES && sectionTitles.length) {
          const title = sectionTitles.shift()!;
          const re = new RegExp(`\n## ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n[\\s\\S]*?(?=\n## |\n*$)`, '');
          const before = content;
          content = content.replace(re, '');
          if (content === before) continue;
          omittedSections.push(title);
        }
        if (Buffer.byteLength(content, 'utf8') > MAX_SKILL_FILE_BYTES) {
          // Last resort: truncate the answers section body (already recorded).
          content = content.slice(0, MAX_SKILL_FILE_BYTES - 500);
          omittedSections.push('truncated-tail');
        }
        if (omittedSections.length) {
          content += `\n\n> Note: the following sections were omitted to stay under Natively's 100 KiB per-file limit: ${omittedSections.join(', ')}. They remain available in InterviewHub's interview session for this application.\n`;
        }
        skillContent = content;
        const { path: skillPath } = writeSkillFile(prepared.name, content);
        const ts = now();
        const existing = getLatestSync(applicationId);
        if (existing) {
          run(`UPDATE skills_sync SET skill_name = ?, skill_path = ?, status = 'file_written', last_synced = ?, resume_version = ?, jd_hash = ?, content_hash = ?, updated_at = ? WHERE id = ?`,
            prepared.name, skillPath, ts, (prepared.ctx.resume?.version as number) ?? null, prepared.jdHash, prepared.contentHash, ts, existing.id);
        } else {
          run(`INSERT INTO skills_sync (id, application_id, candidate_id, skill_name, skill_path, status, last_synced, resume_version, jd_hash, content_hash, version_number) VALUES (?, ?, ?, ?, ?, 'file_written', ?, ?, ?, ?, 1)`,
            newId('sync_'), applicationId, candidateId, prepared.name, skillPath, ts, (prepared.ctx.resume?.version as number) ?? null, prepared.jdHash, prepared.contentHash);
        }
        markStage(jobId, 'building_skill', { status: 'completed', origin: 'fallback', detail: { skillName: prepared.name, skillPath, omittedSections, bytes: Buffer.byteLength(content, 'utf8') } }, STAGE_PROGRESS.building_skill);
      } catch (e) { notePartial('building_skill', failStage('building_skill', e)); }
    }
    current = refresh();

    // ---- Stage 9: installing_natively (non-critical; failure → partial)
    if (!stageDone(current, 'installing_natively')) {
      updateJob(jobId, { current_stage: 'installing_natively', progress: STAGE_PROGRESS.installing_natively });
      try {
        const confirmed = getConfirmedNativelyDir();
        if (!confirmed) {
          throw new Error('Natively Skills directory not confirmed — confirm it once in Prepare Interview, then retry the install from the results screen');
        }
        if (!skillContent) {
          // Skill was built in an earlier run; rebuild from the stored file.
          const prepared = prepareSkillContent(applicationId, resumeId);
          const sync = getLatestSync(applicationId);
          const fsPath = sync?.skill_path as string | undefined;
          skillContent = fsPath && fs.existsSync(fsPath) ? fs.readFileSync(fsPath, 'utf8') : prepared.built.content;
        }
        const result = installPrebuiltSkill(applicationId, skillContent, { confirm_directory: true, explicitResumeId: resumeId });
        markStage(jobId, 'installing_natively', { status: 'completed', origin: 'fallback', detail: { slug: result.slug, slashCommand: result.slash_command, installPath: result.skill_path } }, STAGE_PROGRESS.installing_natively);
      } catch (e) { notePartial('installing_natively', failStage('installing_natively', e)); }
    }
    current = refresh();

    updateJob(jobId, { origin_summary: origins });
    if (partial) {
      completeJob(jobId, 'partial', { stages: errors, message: 'Some stages failed; the rest of the preparation completed. See stage results.' });
    } else {
      completeJob(jobId, 'completed');
    }
    return getJob(jobId)!;
  } catch (e) {
    failJob(jobId, { message: e instanceof Error ? e.message : String(e) });
    return getJob(jobId)!;
  }
}

async function runWorkerLoop(): Promise<void> {
  while (workerRunning) {
    try {
      const job = claimNextJob(WORKER_ID);
      if (!job) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      await processJob(job);
    } catch (e) {
      // Worker never dies on one bad job; log and keep polling.
      console.error('[prepare-worker]', e instanceof Error ? e.message : String(e));
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/** Start the singleton worker (no-op if already running or in tests). */
export function ensureWorker(): void {
  if (workerRunning) return;
  if (process.env.VITEST_WORKER_ID || process.env.NODE_ENV === 'test') return;
  workerRunning = true;
  workerPromise = runWorkerLoop().finally(() => { workerRunning = false; });
  void workerPromise;
}

export function __stopWorkerForTests(): void {
  workerRunning = false;
}

export { createJob };

// Lazy start when this module is imported in a real server runtime only
// (never in tests — VITEST_WORKER_ID / NODE_ENV guards above — and never
// during `next build`, where a polling loop would keep the build alive).
if (typeof window === 'undefined' && !process.env.VITEST_WORKER_ID && process.env.NODE_ENV !== 'test' && process.env.NEXT_PHASE !== 'phase-production-build') {
  try { ensureWorker(); } catch { /* worker start is best-effort */ }
}
