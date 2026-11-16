// Natively Skill generation — FILE-BASED export/import workflow only.
//
// There is no Natively API integration and no automatic activation here:
// InterviewHub writes one standalone `interview-{candidate}-{company}-{role}.md`
// file per application into SKILLS_DIR (default data/skills/). The user
// imports that file through Natively → Skills and confirms import /
// activation manually. A generated file is NEVER proof Natively loaded it,
// so generation records status 'file_written', never 'imported' or
// 'activation_verified'.
//
// Lifecycle statuses (skills_sync.status):
//   not_generated | generated | file_written | awaiting_import | imported |
//   activation_verified | outdated | failed
// 'generated' is the transient pre-write state; a successfully written file
// is 'file_written'. 'awaiting_import' is set when the user opens the
// import instructions. 'imported' / 'activation_verified' are ONLY set by
// explicit user confirmation (POST /api/natively/confirm).

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { get, all, run, newId } from './db';
import { skillsDir } from './files';
import { guardPath, safeFilename } from './security';
import { slug } from './serialize';
import { ApiError } from './errors';
import { resolveResumeForApplication, loadApplicationOr404, loadCandidateForApplication } from './context';
import { retrieveContext } from './rag';
import { getAiSettings } from './ai/providers';

export const SKILL_STATUSES = [
  'not_generated',
  'generated',
  'file_written',
  'awaiting_import',
  'imported',
  'activation_verified',
  'outdated',
  'failed',
] as const;
export type SkillStatus = (typeof SKILL_STATUSES)[number];

/** Default Skill context budget (chars of resume+JD excerpt) when unset. */
export const DEFAULT_SKILL_CONTEXT_CHARS = 12000;

export function skillNameFor(candidateName: string, company: string, title: string): string {
  return `interview-${slug(candidateName)}-${slug(company)}-${slug(title)}`;
}

export function skillFileName(name: string): string {
  return `${safeFilename(name)}.md`;
}

/** SHA-256 hex of a string ('' for null/undefined). Used for JD/outdated checks. */
export function sha256(text: string | null | undefined): string {
  return crypto.createHash('sha256').update(text || '', 'utf8').digest('hex');
}

export function jdHashFor(app: Record<string, unknown>): string {
  return sha256((app.jd_text as string) || '');
}

/** Escape a value for double-quoted YAML frontmatter. */
export function escapeYaml(value: string): string {
  return `"${String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')}"`;
}

/** Configured Skill context budget (chars); falls back to the default. */
export function skillContextChars(): number {
  try {
    const row = get<Record<string, unknown>>(`SELECT skill_context_chars FROM ai_settings WHERE id = 1`);
    const n = row?.skill_context_chars as number | null;
    if (typeof n === 'number' && n > 0) return Math.min(n, 200000);
  } catch { /* column may predate migration 002 on a stale DB — use default */ }
  return DEFAULT_SKILL_CONTEXT_CHARS;
}

export interface SkillBuildOptions {
  /** Total chars of resume+JD excerpt content (default: configured value). */
  contextChars?: number;
  /** Pre-retrieved, application-scoped resume chunks (selected resume only). */
  resumeChunks?: string[];
  /** Pre-retrieved JD chunks for this application. */
  jdChunks?: string[];
  /** 'selected' | 'active' — how the resume was resolved, shown in the Skill. */
  resumeSource?: string;
}

export interface SkillBuildResult {
  content: string;
  /** Chars omitted by excerpting (0 = complete documents included). */
  omittedChars: number;
  truncated: boolean;
  resumeIncludedChars: number;
  jdIncludedChars: number;
}

/**
 * Build the complete SKILL.md content for one application.
 * Never silently truncates: excerpts are labelled and the omitted char
 * count is reported in the file and in the result. Candidate facts and
 * employer requirements are kept in separate sections, and the JD is
 * explicitly NOT evidence of candidate experience.
 */
export function buildSkillMd(
  app: Record<string, unknown>,
  candidate: Record<string, unknown>,
  resume: Record<string, unknown> | undefined | null,
  stories: Array<Record<string, unknown>>,
  opts: SkillBuildOptions = {},
): SkillBuildResult {
  const name = skillNameFor(String(candidate.name || 'candidate'), String(app.company || ''), String(app.title || ''));
  if (!candidate.name || !app.company || !app.title) {
    throw new ApiError(400, 'Cannot generate a Skill without a candidate name, company, and role title.');
  }
  const budget = opts.contextChars && opts.contextChars > 0 ? opts.contextChars : skillContextChars();
  const resumeText = String(resume?.extracted_text || '');
  const jdText = String(app.jd_text || '');
  if (!jdText.trim()) {
    throw new ApiError(400, 'Cannot generate a Skill without a job description — add the JD to this application first.');
  }
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(((resume?.parsed as string) || '{}') as string) as Record<string, unknown>; } catch { parsed = {}; }
  const skills = ((parsed.skills as string[]) || []).join(', ');
  const resumeVersion = (resume?.version as number | undefined) ?? null;

  // Budget split: ~55% resume evidence, ~45% JD. Chunks (already
  // relevance-ranked by the caller) win over raw slices when provided.
  const resumeBudget = Math.floor(budget * 0.55);
  const jdBudget = budget - resumeBudget;
  const resumeSource = opts.resumeChunks?.length
    ? opts.resumeChunks.join('\n---\n')
    : resumeText;
  const jdSource = opts.jdChunks?.length ? opts.jdChunks.join('\n---\n') : jdText;
  const resumeExcerpt = resumeSource.slice(0, resumeBudget);
  const jdExcerpt = jdSource.slice(0, jdBudget);
  const omittedChars =
    Math.max(0, resumeSource.length - resumeExcerpt.length) + Math.max(0, jdSource.length - jdExcerpt.length);
  const truncated = omittedChars > 0;

  const stars =
    stories
      .map((s) => {
        let tech = '';
        try { tech = (JSON.parse((s.technologies as string) || '[]') as string[]).join(', '); } catch { tech = ''; }
        return `### ${s.title}\n- Situation: ${s.situation || ''}\n- Task: ${s.task || ''}\n- Action: ${s.action || ''}\n- Result: ${s.result || ''}\n- Technologies: ${tech}\n- Verification: ${s.verification_status || 'draft'}`;
      })
      .join('\n\n') || 'No STAR stories on file.';
  const verifiedStars = stories.filter((s) => s.verification_status === 'verified').length;

  const truncationNote = truncated
    ? `\n> ⚠ EXCERPTED CONTENT — this Skill contains excerpts, not the complete documents (${omittedChars} omitted in total).\n> Resume: ${resumeExcerpt.length} of ${resumeSource.length} characters included (${Math.max(0, resumeSource.length - resumeExcerpt.length)} omitted). JD: ${jdExcerpt.length} of ${jdSource.length} characters included (${Math.max(0, jdSource.length - jdExcerpt.length)} omitted).\n> The full resume and job description remain stored in InterviewHub (resume v${resumeVersion ?? '?'}, stored JD). Do not claim completeness beyond what is quoted below.\n`
    : `\n> Complete documents included: the full resume text (${resumeSource.length} chars) and full job description (${jdSource.length} chars) are quoted below.\n`;

  const content = `---\nname: ${escapeYaml(name)}\ndescription: ${escapeYaml(`Interview preparation skill for ${candidate.name} — ${app.title} at ${app.company}. Use when preparing for, rehearsing, or debriefing this interview.`)}\n---\n\n# Interview Prep: ${candidate.name} — ${app.title} at ${app.company}\n\n## Factual-accuracy rules (mandatory)\n- Never invent metrics, projects, employers, dates, or skills.\n- Cite only evidence from the resume, JD, and STAR stories below.\n- Anything not evidenced must be marked "Not demonstrated".\n- Do not hallucinate interview outcomes or offers.\n- The job description below states EMPLOYER REQUIREMENTS. It is never evidence that the candidate has that experience.\n- If a required skill has no resume evidence, say so honestly and suggest a truthful framing (e.g. transferable experience), never a fabricated claim.\n\n## Candidate facts (verified profile)\n- Name: ${candidate.name}\n- Headline: ${candidate.headline || ''}\n- Location: ${candidate.location || ''}\n- Experience: ${candidate.total_experience_years ?? 'unknown'} years\n- Skills: ${skills}\n- Summary: ${candidate.summary || ''}\n\n## Resume evidence — v${resumeVersion ?? '?'}${resume ? ` (${resume.filename || ''})` : ''}\nSource: ${opts.resumeSource === 'selected' ? 'application-selected resume version' : 'candidate active resume version'}${truncated ? ' (excerpted — see note below)' : ''}.\n${truncationNote}\n${resumeExcerpt || 'No resume on file.'}\n\n## Job description — employer requirements (NOT candidate evidence)\n${jdExcerpt || 'No JD on file.'}\n\n## STAR stories (${stories.length} total, ${verifiedStars} verified)\n${stars}\n\n## Interview instructions\n- Answer in the first person, conversationally, in STAR structure for behavioral questions.\n- Technical questions: give depth only where the resume shows hands-on experience; label theoretical knowledge as theoretical.\n- Answer lengths: 30 seconds for introductions, 60 seconds for standard answers, 90 seconds for detailed walkthroughs, longer only when asked for detail.\n- When a skill gap comes up, name it plainly, note any transferable experience, and say what the candidate is doing to close it. Never paper over gaps.\n- Suggested follow-up questions to ask the interviewer are welcome when the JD leaves something open.\n\n## Application notes\n${app.notes || ''}\n${app.company_notes ? `\nCompany notes: ${app.company_notes}` : ''}\n`;
  return { content, omittedChars, truncated, resumeIncludedChars: resumeExcerpt.length, jdIncludedChars: jdExcerpt.length };
}

/**
 * Resolve a collision-free skill name. If another application already owns
 * the base name, a stable numeric suffix is added (-2, -3, …) — never a
 * silent overwrite of another application's Skill.
 */
export function resolveSkillName(baseName: string, applicationId: string): string {
  const rows = all<Record<string, unknown>>(
    `SELECT application_id, skill_name FROM skills_sync WHERE skill_name = ? OR skill_name LIKE ?`,
    baseName,
    `${baseName}-%`,
  );
  const ownedByOther = rows.some((r) => r.application_id !== applicationId);
  if (!ownedByOther) return baseName;
  let n = 2;
  while (true) {
    const candidate = `${baseName}-${n}`;
    const clash = all<Record<string, unknown>>(`SELECT application_id FROM skills_sync WHERE skill_name = ?`, candidate);
    if (!clash.some((r) => r.application_id !== applicationId)) return candidate;
    n += 1;
    if (n > 999) throw new ApiError(500, 'Too many Skill name collisions for this application');
  }
}

/** Who owns a skill file on disk (by skills_sync row), if anyone. */
export function skillOwner(skillName: string): string | null {
  const row = get<Record<string, unknown>>(
    `SELECT application_id FROM skills_sync WHERE skill_name = ? ORDER BY last_synced DESC LIMIT 1`,
    skillName,
  );
  return (row?.application_id as string) || null;
}

export interface WriteSkillResult {
  path: string;
  previousContent: string | null;
}

/**
 * Atomic write of a Skill file. Only interview-* files may be written, and
 * only inside the configured skills directory. Returns the previous content
 * (for version history) when the file already existed.
 */
export function writeSkillFile(name: string, content: string): WriteSkillResult {
  if (!name.startsWith('interview-')) throw new Error('Only interview-* skills may be written');
  if (!content || !content.trim()) throw new Error('Refusing to write an empty Skill file');
  const dir = skillsDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = guardPath(dir, skillFileName(name));
  const previousContent = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
  return { path: file, previousContent };
}

export function readSkillFile(name: string): string | null {
  if (!name.startsWith('interview-')) return null;
  const file = guardPath(skillsDir(), skillFileName(name));
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

export function deleteSkillFile(name: string): boolean {
  if (!name.startsWith('interview-')) return false;
  try {
    const file = guardPath(skillsDir(), skillFileName(name));
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      return true;
    }
  } catch { /* already gone / invalid — treat as deleted */ }
  return false;
}

export function listInterviewSkills(): Array<{ name: string; path: string }> {
  const dir = skillsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('interview-') && f.endsWith('.md'))
    .map((f) => ({ name: f.replace(/\.md$/, ''), path: path.join(dir, f) }));
}

export interface ApplicationContext {
  app: Record<string, unknown>;
  candidate: Record<string, unknown>;
  resume: Record<string, unknown> | null;
  resumeSource: 'selected' | 'active' | 'none';
  stories: Array<Record<string, unknown>>;
}

/**
 * Load the full context for one application, resolving the resume through
 * the shared resolver (selected resume wins; invalid/deleted selections
 * throw 400 instead of silently substituting another resume).
 */
export function loadApplicationContext(
  applicationId: string,
  explicitResumeId?: string | null,
): ApplicationContext | null {
  let app: Record<string, unknown>;
  try {
    app = loadApplicationOr404(applicationId);
  } catch {
    return null;
  }
  const candidate = loadCandidateForApplication(app);
  const { resume, source } = resolveResumeForApplication(app, explicitResumeId);
  const stories = all<Record<string, unknown>>(
    `SELECT * FROM star_stories WHERE candidate_id = ? AND archived_at IS NULL ORDER BY created_at DESC`,
    app.candidate_id,
  );
  return { app, candidate, resume, resumeSource: source, stories };
}

/** Latest skills_sync row for an application, if any. */
export function getLatestSync(applicationId: string): Record<string, unknown> | undefined {
  return get<Record<string, unknown>>(
    `SELECT * FROM skills_sync WHERE application_id = ? ORDER BY last_synced DESC LIMIT 1`,
    applicationId,
  );
}

/** True when the stored Skill no longer matches the current resume/JD. */
export function isSyncOutdated(
  sync: Record<string, unknown> | undefined,
  app: Record<string, unknown>,
  resume: Record<string, unknown> | null,
): boolean {
  if (!sync) return false;
  const status = sync.status as string;
  if (status === 'outdated' || status === 'failed') return true;
  const storedResumeVersion = sync.resume_version as number | null;
  const storedJdHash = sync.jd_hash as string | null;
  if (storedResumeVersion !== null && storedResumeVersion !== undefined && resume && storedResumeVersion !== (resume.version as number)) return true;
  if (storedJdHash && storedJdHash !== jdHashFor(app)) return true;
  if (!resume && storedResumeVersion !== null && storedResumeVersion !== undefined) return true;
  return false;
}

/** Record the previous valid content as a restorable version. */
export function recordSkillVersion(
  applicationId: string,
  skillName: string,
  skillPath: string,
  content: string,
): number {
  const row = get<{ maxv: number | null }>(
    `SELECT MAX(version_number) AS maxv FROM skill_versions WHERE application_id = ?`,
    applicationId,
  );
  const version = (row?.maxv ?? 0) + 1;
  run(
    `INSERT INTO skill_versions (id, application_id, skill_name, skill_path, version_number, content) VALUES (?, ?, ?, ?, ?, ?)`,
    newId('skv_'),
    applicationId,
    skillName,
    skillPath,
    version,
    content,
  );
  return version;
}

export function listSkillVersions(applicationId: string): Array<Record<string, unknown>> {
  return all<Record<string, unknown>>(
    `SELECT id, application_id, skill_name, skill_path, version_number, created_at, length(content) AS content_chars FROM skill_versions WHERE application_id = ? ORDER BY version_number DESC`,
    applicationId,
  );
}

export interface PreparedSkill {
  ctx: ApplicationContext;
  /** Collision-resolved file name (without .md). */
  name: string;
  built: SkillBuildResult;
  jdHash: string;
  contentHash: string;
  /** Absolute directory the file will be written to. */
  outputDir: string;
}

/**
 * Shared preparation for generate + preview: loads the application context
 * through the shared resume resolver, retrieves application-scoped RAG
 * chunks for the SELECTED resume + JD (never another resume or candidate),
 * and builds the Skill content. Writes nothing.
 */
export function prepareSkillContent(
  applicationId: string,
  explicitResumeId?: string | null,
): PreparedSkill {
  const ctx = loadApplicationContext(applicationId, explicitResumeId);
  if (!ctx) throw new ApiError(404, 'Application not found');
  if (!String(ctx.app.jd_text || '').trim()) {
    throw new ApiError(400, 'Cannot generate a Skill without a job description — add the JD to this application first.');
  }
  // RAG relevance: JD requirements drive chunk selection so long documents
  // contribute their most relevant sections instead of a blind head-slice.
  let resumeChunks: string[] = [];
  let jdChunks: string[] = [];
  try {
    const settings = getAiSettings();
    const query = String(ctx.app.jd_text || '').slice(0, 500) || 'experience skills';
    const { chunks } = retrieveContext({
      candidateId: String(ctx.app.candidate_id),
      applicationId,
      resumeId: ctx.resume ? String(ctx.resume.id) : null,
      query,
      limit: 14,
      redactPii: settings.redact_pii,
    });
    resumeChunks = chunks.filter((c) => c.source_type === 'resume').map((c) => c.chunk_text);
    jdChunks = chunks.filter((c) => c.source_type === 'jd').map((c) => c.chunk_text);
  } catch (e) {
    // RAG is an optimisation, not a requirement: fall back to raw excerpts.
    if (e instanceof ApiError) throw e;
    resumeChunks = [];
    jdChunks = [];
  }
  const baseName = skillNameFor(
    String(ctx.candidate.name || 'candidate'),
    String(ctx.app.company || ''),
    String(ctx.app.title || ''),
  );
  const name = resolveSkillName(baseName, applicationId);
  const built = buildSkillMd(ctx.app, ctx.candidate, ctx.resume, ctx.stories, {
    resumeChunks: resumeChunks.length ? resumeChunks : undefined,
    jdChunks: jdChunks.length ? jdChunks : undefined,
    resumeSource: ctx.resumeSource,
  });
  return {
    ctx,
    name,
    built,
    jdHash: jdHashFor(ctx.app),
    contentHash: sha256(built.content),
    outputDir: skillsDir(),
  };
}

/** The 7 manual Natively activation steps, shown in-app (never auto-claimed). */
export const NATIVELY_IMPORT_STEPS: string[] = [
  'Open Natively.',
  'Navigate to Skills.',
  'Add or point Natively to the generated interview Skill file.',
  'Select the generated interview-*.md file.',
  'Confirm that the Skill appears in Natively\u2019s Skills list.',
  'Activate the Skill.',
  'Test it with an interview question.',
];
