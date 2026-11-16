import fs from 'fs';
import os from 'os';
import path from 'path';
import { dataDir } from './db';
import { guardPath, safeFilename } from './security';

export function uploadsDir(candidateId: string): string {
  const dir = path.join(dataDir(), 'uploads', candidateId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Atomic write: write to tmp file in same dir, then rename. Returns stored relative path. */
export async function saveUpload(candidateId: string, filename: string, bytes: Buffer): Promise<{ storedPath: string; safeName: string }> {
  const safeName = `${Date.now()}-${safeFilename(filename)}`;
  const dir = uploadsDir(candidateId);
  const dest = guardPath(dir, safeName);
  const tmp = `${dest}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  await fs.promises.writeFile(tmp, bytes);
  await fs.promises.rename(tmp, dest);
  return { storedPath: path.join('uploads', candidateId, safeName), safeName };
}

export function deleteStoredFile(storedPath: string): void {
  try {
    const abs = guardPath(dataDir(), storedPath);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch { /* already gone / invalid path — ignore */ }
}

export function skillsDir(): string {
  const env = process.env.SKILLS_DIR;
  if (env) return path.isAbsolute(env) ? env : path.resolve(process.cwd(), env);
  return path.join(dataDir(), 'skills');
}

// ---------------------------------------------------------------------------
// Natively Skills directory (automatic installation target).
//
// Verified from Natively's own public source (Natively-AI-assistant/
// natively-cluely-ai-assistant, electron/services/SkillsManager.ts:608):
// skills live in Electron `app.getPath('userData') + '/skills'`, i.e. on
// macOS `~/Library/Application Support/Natively/skills/`, flat layout
// `<skillsDir>/<folder>/SKILL.md` (nested subfolders are NOT discovered).
// There is NO public Natively API for installation — this is a filesystem
// install into that verified directory, the same mechanism Natively's own
// in-app upload uses (stage, then rename into place).
//
// Resolution order — NEVER silently falls back to data/skills/ for install
// (that is the manual-export directory, a different thing):
//   1. NATIVELY_SKILLS_DIR, when set (must be absolute).
//   2. The macOS default above, on darwin only.
//   3. Unconfigured (install is blocked until the user configures a
//      verified directory and confirms it in the UI).
// ---------------------------------------------------------------------------

/** macOS default Natively Skills directory for a given home directory. */
export function macosDefaultNativelySkillsDir(homeDir: string = os.homedir()): string {
  return path.join(homeDir, 'Library', 'Application Support', 'Natively', 'skills');
}

export interface NativelyDirInfo {
  /** A directory is configured (env or macOS default), even if it does not exist yet. */
  configured: boolean;
  /** Resolved absolute path, or null when unconfigured / invalid. */
  resolved_path: string | null;
  source: 'env' | 'macos-default' | 'unconfigured' | 'invalid';
  /** The directory exists on disk right now. */
  exists: boolean;
  /** It exists and is a directory. */
  is_directory: boolean;
  /** The Natively userData parent (~/Library/Application Support/Natively) exists — evidence Natively was installed/run. */
  natively_detected: boolean;
  /** True when the directory exists and is a directory (install may proceed without extra confirmation). */
  verified: boolean;
  /** True when the directory does not exist yet but its parent does, so it can be created. */
  can_create: boolean;
  /** Human-readable problem, or null. */
  error: string | null;
}

function dirInfoFor(resolved: string, source: NativelyDirInfo['source']): NativelyDirInfo {
  let exists = false;
  let isDirectory = false;
  try {
    const st = fs.statSync(resolved);
    exists = true;
    isDirectory = st.isDirectory();
  } catch { /* does not exist (or unreadable) */ }
  const parent = path.dirname(resolved);
  let parentIsDir = false;
  try { parentIsDir = fs.statSync(parent).isDirectory(); } catch { /* no parent */ }
  // Natively's userData dir is the parent of the skills dir.
  const nativelyDetected = parentIsDir;
  return {
    configured: true,
    resolved_path: resolved,
    source,
    exists,
    is_directory: isDirectory,
    natively_detected: nativelyDetected,
    verified: exists && isDirectory,
    can_create: !exists && parentIsDir,
    error: exists && !isDirectory ? `Configured Natively Skills path exists but is not a directory: ${resolved}` : null,
  };
}

export function resolveNativelySkillsDir(): NativelyDirInfo {
  const env = (process.env.NATIVELY_SKILLS_DIR || '').trim();
  if (env) {
    if (!path.isAbsolute(env)) {
      return {
        configured: false,
        resolved_path: null,
        source: 'invalid',
        exists: false,
        is_directory: false,
        natively_detected: false,
        verified: false,
        can_create: false,
        error: 'NATIVELY_SKILLS_DIR must be an absolute path',
      };
    }
    return dirInfoFor(path.normalize(env), 'env');
  }
  if (process.platform === 'darwin') {
    return dirInfoFor(macosDefaultNativelySkillsDir(), 'macos-default');
  }
  return {
    configured: false,
    resolved_path: null,
    source: 'unconfigured',
    exists: false,
    is_directory: false,
    natively_detected: false,
    verified: false,
    can_create: false,
    error: 'Natively Skills directory is not configured. Set NATIVELY_SKILLS_DIR to the absolute path of Natively\'s Skills directory (macOS default: ~/Library/Application Support/Natively/skills).',
  };
}

/** Resolved Natively Skills directory, or null when unconfigured/invalid. */
export function nativelySkillsDir(): string | null {
  return resolveNativelySkillsDir().resolved_path;
}
