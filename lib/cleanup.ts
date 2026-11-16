// File cleanup for permanent deletes.
//
// SQLite FK cascades remove database rows, but files on disk (uploaded
// resumes, generated Natively Skills) are NOT database rows — they must be
// removed explicitly or they become orphans. Every permanent delete
// collects the file list BEFORE deleting DB rows, deletes the rows, then
// deletes the files and reports partial failures instead of silently
// pretending everything is gone.

import fs from 'fs';
import path from 'path';
import { all, dataDir } from './db';
import { skillsDir } from './files';

export interface FileCleanupResult {
  removed: string[];
  errors: string[];
}

/**
 * Storage roots cleanup may delete inside: the data directory (uploads,
 * SQLite) and the configured skills directory (which may be an absolute
 * path outside DATA_DIR, e.g. a Natively folder on macOS). Anything else
 * is refused — a stored_path / skill_path from the DB must never be able
 * to point cleanup at an arbitrary file (path.resolve() would otherwise
 * honour an absolute stored value verbatim).
 */
export function isDeletablePath(p: string): boolean {
  const resolved = path.resolve(p);
  for (const root of [dataDir(), skillsDir()]) {
    const r = path.resolve(root);
    if (resolved === r || resolved.startsWith(r + path.sep)) return true;
  }
  return false;
}

/** Delete a list of absolute paths; collect failures instead of throwing. */
export function deleteFilesSafely(paths: string[]): FileCleanupResult {
  const removed: string[] = [];
  const errors: string[] = [];
  for (const p of paths) {
    if (!isDeletablePath(p)) {
      errors.push(`${p}: refused — outside configured storage directories`);
      continue;
    }
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        removed.push(p);
      }
    } catch (e) {
      errors.push(`${p}: ${e instanceof Error ? e.message : 'delete failed'}`);
    }
  }
  return { removed, errors };
}

/** All on-disk files owned by one candidate: resume uploads + Skill files. */
export function candidateFilePaths(candidateId: string): string[] {
  const paths: string[] = [];
  const resumes = all<{ stored_path: string }>(`SELECT stored_path FROM resumes WHERE candidate_id = ?`, candidateId);
  for (const r of resumes) {
    try {
      const abs = path.resolve(dataDir(), r.stored_path);
      paths.push(abs);
    } catch { /* invalid stored path — skip, DB row is going away anyway */ }
  }
  const skills = all<{ skill_path: string }>(
    `SELECT s.skill_path FROM skills_sync s JOIN applications a ON a.id = s.application_id WHERE a.candidate_id = ?`,
    candidateId,
  );
  for (const s of skills) if (s.skill_path) paths.push(s.skill_path);
  return [...new Set(paths)];
}

/** All Skill files owned by one application (and only that application). */
export function applicationSkillPaths(applicationId: string): string[] {
  const skills = all<{ skill_path: string }>(`SELECT skill_path FROM skills_sync WHERE application_id = ?`, applicationId);
  return [...new Set(skills.map((s) => s.skill_path).filter(Boolean) as string[])];
}

/**
 * Remove a candidate's uploads directory tree (resumes + any strays) after
 * its DB rows are gone. Returns cleanup result; never throws.
 */
export function removeCandidateUploadsDir(candidateId: string): FileCleanupResult {
  // Candidate ids are server-generated, but never trust a path segment:
  // a '..' in the id must not let the recursive delete escape uploads/.
  if (!/^[A-Za-z0-9_-]+$/.test(candidateId)) {
    return { removed: [], errors: [`uploads/${candidateId}: refused — invalid candidate id`] };
  }
  const dir = path.join(dataDir(), 'uploads', candidateId);
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      return { removed: [dir], errors: [] };
    }
  } catch (e) {
    return { removed: [], errors: [`${dir}: ${e instanceof Error ? e.message : 'delete failed'}`] };
  }
  return { removed: [], errors: [] };
}

/**
 * Delete a candidate's files from a PRE-DELETE snapshot of paths.
 * Call candidateFilePaths() BEFORE deleting the DB rows (FK cascade removes
 * the rows the paths come from), then deleteFilesSafely() + this uploads-dir
 * removal AFTER the rows are gone. Partial failures are reported, never hidden.
 */
export function deleteCandidateFilesFromSnapshot(candidateId: string, paths: string[]): FileCleanupResult {
  const files = deleteFilesSafely(paths);
  const dirResult = removeCandidateUploadsDir(candidateId);
  return { removed: [...files.removed, ...dirResult.removed], errors: [...files.errors, ...dirResult.errors] };
}

/** Delete one application's Skill files from a pre-delete snapshot. */
export function deleteApplicationFilesFromSnapshot(paths: string[]): FileCleanupResult {
  return deleteFilesSafely(paths);
}
