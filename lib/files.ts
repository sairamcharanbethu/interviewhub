import fs from 'fs';
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
