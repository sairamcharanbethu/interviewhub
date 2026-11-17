// Automatic Natively Skill installation — filesystem-based install into
// Natively's verified local Skills directory.
//
// Investigation basis (Natively's own public source, main branch,
// Natively-AI-assistant/natively-cluely-ai-assistant — see
// NATIVELY_INSTALL_INVESTIGATION.md):
// - Skills live in Electron `app.getPath('userData') + '/skills'`
//   (electron/services/SkillsManager.ts:608) → macOS
//   `~/Library/Application Support/Natively/skills/`.
// - Flat layout only: `<skillsDir>/<folder>/SKILL.md`; nested subfolders
//   are NOT discovered (SkillsManager.ts:640-645).
// - The visible id is the slug of the SKILL.md frontmatter `name:` field
//   (SkillValidator.ts:174-185, slug max 80 chars); `description:` is
//   required; per-file max 100 KiB (MAX_SKILL_FILE_BYTES).
// - Natively re-reads the skills folder when its window regains focus
//   (SkillsSettings.tsx:127-129) — no restart is required, and no
//   activation/loading claim is made here.
// - Natively's own installer (SkillInstaller.ts) stages under a unique
//   temp dir, then renames into `<skillsRoot>/<id>/`, rolling back on
//   failure. This module mirrors that: stage a tmp file INSIDE the
//   destination folder, fsync, rename into place.
// - There is NO public Natively API for install.
//
// Safety rules (enforced here, not just in the UI):
// - Writes/deletes happen ONLY inside the verified Natively Skills
//   directory (realpath containment, symlink escape rejected).
// - Only the exact `<slug>` folder registered in skills_sync for the
//   application is ever installed, updated, or uninstalled. Unrelated
//   Natively Skills are never touched.
// - 'installed' means ONLY "file written to the verified directory".
//   It does NOT mean Natively loaded, enabled, or activated the Skill.
// - No shell commands, no secrets in logs, no secrets in the Skill.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { get, run, newId, now, transaction } from './db';
import { resolveNativelySkillsDir } from './files';
import { ApiError } from './errors';
import {
  prepareSkillContent,
  getLatestSync,
  recordSkillVersion,
  sha256,
} from './natively';

/** Natively's per-file size cap (MAX_SKILL_FILE_BYTES in its source). */
export const MAX_SKILL_FILE_BYTES = 100 * 1024;

/** Built-in Natively Skill ids that must never be collided with. */
export const NATIVELY_RESERVED_SLUGS = new Set(['humanize-ai-text', 'humanize-text']);

/** Natively SkillValidator slug cap (80 chars). */
export const MAX_INSTALL_SLUG_CHARS = 80;

export interface InstallOptions {
  explicitResumeId?: string | null;
  /** User confirmed overwriting a foreign/existing folder with this slug. */
  confirm_overwrite?: boolean;
  /** User confirmed the (not yet verified) directory really is Natively's Skills directory. */
  confirm_directory?: boolean;
}

export interface InstallResult {
  status: 'installed';
  slug: string;
  skill_name: string;
  skill_path: string;
  installed_at: string;
  updated_at: string;
  slash_command: string;
  content_hash: string;
  truncated: boolean;
  omitted_chars: number;
  unchanged: boolean;
  natively_dir: string;
  refresh_note: string;
}

export interface UninstallResult {
  status: 'uninstalled';
  slug: string;
  removed: boolean;
  already_gone: boolean;
}

export const NATIVELY_REFRESH_NOTE =
  'Bring Natively to the front — it re-reads the Skills folder when its window regains focus. If the skill does not appear, use Skills → Refresh in Natively. Installed means the file was written to Natively\'s Skills directory; it does not mean Natively has loaded or activated it.';

/** One-time Natively directory confirmation (persisted in ai_settings). */
export function getConfirmedNativelyDir(): { dir: string; confirmedAt: string | null } | null {
  try {
    const row = get<Record<string, unknown>>(`SELECT confirmed_natively_dir, confirmed_natively_at FROM ai_settings WHERE id = 1`);
    const dir = row?.confirmed_natively_dir as string | undefined;
    if (!dir) return null;
    return { dir, confirmedAt: (row?.confirmed_natively_at as string) || null };
  } catch { return null; }
}

export function setConfirmedNativelyDir(dir: string): { dir: string; confirmedAt: string } {
  let canonical = dir;
  try { canonical = fs.realpathSync(dir); } catch { canonical = path.normalize(dir); }
  const ts = now();
  run(`UPDATE ai_settings SET confirmed_natively_dir = ?, confirmed_natively_at = ? WHERE id = 1`, canonical, ts);
  return { dir: canonical, confirmedAt: ts };
}

/** Install destination: the user-confirmed directory wins; otherwise the resolved (env/macOS-default) directory. */
export function resolveInstallDir(): { resolved_path: string | null; source: string; verified: boolean; error: string | null; confirmed: boolean } {
  const confirmed = getConfirmedNativelyDir();
  if (confirmed) {
    let exists = false;
    let isDir = false;
    try { const st = fs.statSync(confirmed.dir); exists = true; isDir = st.isDirectory(); } catch { /* missing */ }
    return { resolved_path: confirmed.dir, source: 'confirmed', verified: exists && isDir, error: exists && !isDir ? `Confirmed Natively Skills path exists but is not a directory: ${confirmed.dir}` : null, confirmed: true };
  }
  const info = resolveNativelySkillsDir();
  return { resolved_path: info.resolved_path, source: info.source, verified: info.verified, error: info.error, confirmed: false };
}

/**
 * Install prebuilt Skill content (e.g. the full prep-package Skill from the
 * Prepare job) into the verified Natively Skills directory. installSkill
 * delegates here after generating content via prepareSkillContent.
 */
export function installPrebuiltSkill(
  applicationId: string,
  content: string,
  opts: InstallOptions = {},
): InstallResult {
  const prepared = prepareSkillContent(applicationId, opts.explicitResumeId ?? null);
  const { ctx, name, jdHash } = prepared;
  const contentHash = sha256(content);
  const dirInfo = resolveInstallDir();
  if (!dirInfo.resolved_path) {
    const msg = dirInfo.error || 'Natively Skills directory is not configured. Set NATIVELY_SKILLS_DIR to the absolute path of Natively\'s Skills directory, or install Natively so its default directory exists.';
    recordInstallFailure(applicationId, msg);
    throw new ApiError(400, msg);
  }
  if (!dirInfo.verified && !opts.confirm_directory) {
    throw new InstallNeedsConfirmation(
      `The Natively Skills directory ${dirInfo.resolved_path} could not be verified (${dirInfo.error || 'it does not exist yet'}). Confirm this is really Natively's Skills directory before installing — or install Natively first so the directory exists.`,
      { needs_directory_confirmation: true, resolved_path: dirInfo.resolved_path, source: dirInfo.source, natively_detected: false, can_create: true },
    );
  }
  const byteLength = Buffer.byteLength(content, 'utf8');
  if (byteLength > MAX_SKILL_FILE_BYTES) {
    const msg = `Generated Skill is ${byteLength} bytes, over Natively's ${MAX_SKILL_FILE_BYTES}-byte per-file limit. Reduce the Skill context budget in Natively settings and try again.`;
    recordInstallFailure(applicationId, msg);
    throw new ApiError(413, msg);
  }
  const slug = resolveInstallSlug(installSlugFor(name), applicationId);
  const slugCheck = validateInstallSlug(slug);
  if (!slugCheck.ok) {
    recordInstallFailure(applicationId, slugCheck.error);
    throw new ApiError(400, slugCheck.error);
  }
  const root = dirInfo.resolved_path;
  try { fs.mkdirSync(root, { recursive: true }); } catch (e) {
    const msg = `Could not create the Natively Skills directory ${root}: ${e instanceof Error ? e.message : String(e)}`;
    recordInstallFailure(applicationId, msg);
    throw new ApiError(500, msg);
  }
  let rootReal: string;
  try { rootReal = fs.realpathSync(root); } catch {
    const msg = `Could not resolve the Natively Skills directory ${root}`;
    recordInstallFailure(applicationId, msg);
    throw new ApiError(500, msg);
  }
  const folder = path.join(rootReal, slug);
  const skillFile = path.join(folder, 'SKILL.md');
  let previousContent: string | null = null;
  let isUpdate = false;
  try {
    if (fs.existsSync(folder)) {
      const folderReal = realpathInside(rootReal, folder, 'Existing Skill folder');
      void folderReal;
      const ownerRow = get<Record<string, unknown>>(`SELECT application_id FROM skills_sync WHERE install_slug = ? ORDER BY last_synced DESC LIMIT 1`, slug);
      const ownedByThisApp = ownerRow && (ownerRow.application_id as string) === applicationId;
      const existingFile = path.join(folder, 'SKILL.md');
      if (fs.existsSync(existingFile)) previousContent = fs.readFileSync(existingFile, 'utf8');
      isUpdate = Boolean(ownedByThisApp);
      if (!ownedByThisApp) {
        if (!opts.confirm_overwrite) {
          throw new InstallNeedsConfirmation(
            `A Skill folder '${slug}' already exists in Natively's Skills directory and is not registered to this application. Installing would replace it. Confirm to move the existing folder aside (it is preserved as a backup) and install this Skill.`,
            { needs_confirmation: true, slug, skill_path: existingFile },
          );
        }
        const backup = path.join(rootReal, `${slug}.backup-${Date.now().toString(36)}`);
        fs.renameSync(folder, backup);
        previousContent = null;
      }
    }
    fs.mkdirSync(folder, { recursive: true });
    const tmp = path.join(folder, `SKILL.md.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
    try {
      const fd = fs.openSync(tmp, 'w');
      try { fs.writeFileSync(fd, content, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, skillFile);
    } catch (e) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* best effort */ }
      throw e;
    }
    const written = fs.readFileSync(skillFile, 'utf8');
    if (sha256(written) !== contentHash) throw new Error('Installed Skill file failed verification (content hash mismatch)');
  } catch (e) {
    if (e instanceof InstallNeedsConfirmation) throw e;
    if (e instanceof ApiError) { recordInstallFailure(applicationId, e.message); throw e; }
    const msg = e instanceof Error ? e.message : String(e);
    recordInstallFailure(applicationId, msg);
    throw new ApiError(500, `Installation failed: ${msg}`);
  }
  const resumeVersion = (ctx.resume?.version as number | undefined) ?? null;
  const ts = now();
  const unchanged = previousContent !== null && sha256(previousContent) === contentHash;
  void isUpdate;
  transaction(() => {
    if (previousContent !== null && !unchanged) recordSkillVersion(applicationId, name, skillFile, previousContent);
    const prior = get<{ id: string; installed_at: string | null }>(`SELECT id, installed_at FROM skills_sync WHERE application_id = ? AND skill_name = ?`, applicationId, name);
    if (prior) {
      run(`UPDATE skills_sync SET skill_path = ?, status = 'installed', last_synced = ?, resume_version = ?, jd_hash = ?, content_hash = ?, version_number = version_number + 1, install_slug = ?, install_method = 'natively-auto', install_path = ?, installed_at = COALESCE(installed_at, ?), updated_at = ?, install_error = NULL, candidate_id = ? WHERE id = ?`,
        skillFile, ts, resumeVersion, jdHash, contentHash, slug, skillFile, ts, ts, String(ctx.app.candidate_id || ''), prior.id);
    } else {
      run(`INSERT INTO skills_sync (id, application_id, candidate_id, skill_name, skill_path, status, last_synced, resume_version, jd_hash, content_hash, version_number, install_slug, install_method, install_path, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, 'installed', ?, ?, ?, ?, 1, ?, 'natively-auto', ?, ?, ?)`,
        newId('sync_'), applicationId, String(ctx.app.candidate_id || ''), name, skillFile, ts, resumeVersion, jdHash, contentHash, slug, skillFile, ts, ts);
    }
  });
  const built = prepared.built;
  return {
    status: 'installed', slug, skill_name: name, skill_path: skillFile, installed_at: ts, updated_at: ts,
    slash_command: `/${slug}`, content_hash: contentHash, truncated: built.truncated, omitted_chars: built.omittedChars,
    unchanged, natively_dir: rootReal, refresh_note: NATIVELY_REFRESH_NOTE,
  };
}

/** Thrown when the UI must ask the user a question before proceeding. */
export class InstallNeedsConfirmation extends Error {
  status = 409;
  payload: Record<string, unknown>;
  constructor(message: string, payload: Record<string, unknown>) {
    super(message);
    this.payload = payload;
  }
}

/** Slug rules mirror Natively's SkillValidator: lowercase kebab, ≤80 chars. */
export function validateInstallSlug(slug: string): { ok: true } | { ok: false; error: string } {
  if (!slug || typeof slug !== 'string') return { ok: false, error: 'Skill slug is empty' };
  if (slug.length > MAX_INSTALL_SLUG_CHARS) return { ok: false, error: `Skill slug exceeds ${MAX_INSTALL_SLUG_CHARS} characters` };
  if (!/^interview-[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return { ok: false, error: 'Skill slug must be lowercase kebab-case starting with interview-' };
  }
  if (NATIVELY_RESERVED_SLUGS.has(slug)) return { ok: false, error: `Skill slug '${slug}' is reserved by a built-in Natively Skill` };
  if (slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
    return { ok: false, error: 'Skill slug must not contain path separators' };
  }
  return { ok: true };
}

/** Derive the install slug from the manual-export skill name (≤80 chars). */
export function installSlugFor(skillName: string): string {
  return skillName.slice(0, MAX_INSTALL_SLUG_CHARS).replace(/-+$/, '') || 'interview-skill';
}

/**
 * Collision-free install slug: another application's installed slug gets a
 * stable numeric suffix (-2, -3, …) — never a silent overwrite.
 */
export function resolveInstallSlug(baseSlug: string, applicationId: string): string {
  const rows = get<Record<string, unknown>>(
    `SELECT application_id FROM skills_sync WHERE install_slug = ?`,
    baseSlug,
  );
  if (!rows || (rows.application_id as string) === applicationId) return baseSlug;
  let n = 2;
  while (true) {
    const suffix = `-${n}`;
    const candidate = `${baseSlug.slice(0, MAX_INSTALL_SLUG_CHARS - suffix.length).replace(/-+$/, '')}${suffix}`;
    const clash = get<Record<string, unknown>>(
      `SELECT application_id FROM skills_sync WHERE install_slug = ?`,
      candidate,
    );
    if (!clash || (clash.application_id as string) === applicationId) return candidate;
    n += 1;
    if (n > 999) throw new ApiError(500, 'Too many Skill slug collisions for this application');
  }
}

/** True when `target` (which may not exist yet) is inside `root` (realpath). */
export function isPathInside(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep);
}

/**
 * Resolve the real (symlink-free) path of a directory that must exist,
 * and require it to sit inside `rootReal`. Throws ApiError on escape.
 */
function realpathInside(rootReal: string, dir: string, label: string): string {
  let real: string;
  try {
    real = fs.realpathSync(dir);
  } catch {
    throw new ApiError(500, `${label} could not be resolved on disk`);
  }
  if (!isPathInside(rootReal, real)) {
    throw new ApiError(403, `${label} escapes the verified Natively Skills directory — refusing to proceed`);
  }
  return real;
}

function recordInstallFailure(applicationId: string, message: string): void {
  try {
    const sync = getLatestSync(applicationId);
    if (sync) {
      run(
        `UPDATE skills_sync SET status = 'installation_failed', install_error = ?, updated_at = ? WHERE id = ?`,
        message.slice(0, 500),
        now(),
        sync.id,
      );
    }
  } catch { /* failure recording must never mask the original error */ }
}

/**
 * Install (or update) this application's Skill into the verified Natively
 * Skills directory as `<dir>/<slug>/SKILL.md`. Reuses prepareSkillContent,
 * so resume selection (shared resolver) and JD are identical to the
 * manual-export flow. Throws ApiError / InstallNeedsConfirmation.
 */
export function installSkill(
  applicationId: string,
  opts: InstallOptions = {},
): InstallResult {
  // Content is generated via prepareSkillContent (same resume/JD as the
  // manual-export flow); the actual install lives in installPrebuiltSkill
  // so the Prepare job can install its fuller prep-package Skill.
  let prepared;
  try {
    prepared = prepareSkillContent(applicationId, opts.explicitResumeId ?? null);
  } catch (e) {
    if (e instanceof ApiError) recordInstallFailure(applicationId, e.message);
    throw e;
  }
  return installPrebuiltSkill(applicationId, prepared.built.content, opts);
}

/**
 * Uninstall this application's Natively-installed Skill. Deletes ONLY the
 * exact `<slug>` folder registered in skills_sync for this application,
 * and only when it sits inside the verified Natively directory and its
 * SKILL.md still matches what InterviewHub wrote (or is absent). A folder
 * whose contents changed outside InterviewHub is refused, not deleted.
 */
export function uninstallSkill(applicationId: string): UninstallResult {
  const sync = getLatestSync(applicationId);
  const slug = sync?.install_slug as string | undefined;
  const installPath = sync?.install_path as string | undefined;
  if (!sync || !slug || !installPath) {
    throw new ApiError(404, 'No Natively-installed Skill for this application — nothing to uninstall');
  }
  const dirInfo = resolveNativelySkillsDir();
  if (!dirInfo.resolved_path) {
    throw new ApiError(400, 'Natively Skills directory is not configured — cannot verify the installed folder');
  }
  let rootReal: string;
  try {
    rootReal = fs.realpathSync(dirInfo.resolved_path);
  } catch {
    throw new ApiError(400, 'Natively Skills directory does not exist — the installed folder cannot be verified');
  }
  const folder = path.join(rootReal, slug);
  if (!fs.existsSync(folder)) {
    run(
      `UPDATE skills_sync SET status = 'uninstalled', updated_at = ?, install_error = NULL WHERE id = ?`,
      now(),
      sync.id,
    );
    return { status: 'uninstalled', slug, removed: false, already_gone: true };
  }
  // Symlink / path-escape guard: the folder must resolve inside the root.
  const folderReal = realpathInside(rootReal, folder, 'Installed Skill folder');
  void folderReal;
  const skillFile = path.join(folder, 'SKILL.md');
  if (fs.existsSync(skillFile)) {
    const storedHash = sync.content_hash as string | undefined;
    if (storedHash) {
      const currentHash = sha256(fs.readFileSync(skillFile, 'utf8'));
      if (currentHash !== storedHash) {
        throw new ApiError(
          409,
          'The installed Skill file was changed outside InterviewHub — refusing to delete it. Remove the folder manually if you are sure it should go.',
        );
      }
    }
  }
  // Only remove the registered folder itself — never siblings.
  fs.rmSync(folder, { recursive: true, force: true });
  if (fs.existsSync(folder)) throw new ApiError(500, 'Uninstall failed: the Skill folder is still present');
  run(
    `UPDATE skills_sync SET status = 'uninstalled', updated_at = ?, install_error = NULL WHERE id = ?`,
    now(),
    sync.id,
  );
  return { status: 'uninstalled', slug, removed: true, already_gone: false };
}

/**
 * True when a freshly generated Skill differs from the installed one —
 * i.e. an update is available. Advisory only; never mutates stored state.
 */
export function installUpdateAvailable(applicationId: string): boolean {
  const sync = getLatestSync(applicationId);
  if (!sync || (sync.status as string) !== 'installed') return false;
  const storedHash = sync.content_hash as string | undefined;
  if (!storedHash) return false;
  try {
    const prepared = prepareSkillContent(applicationId);
    return prepared.contentHash !== storedHash;
  } catch {
    return false;
  }
}
