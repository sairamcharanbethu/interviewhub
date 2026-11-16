import path from 'path';

const WINDOW_MS = 60_000;
const MAX_REQ = 100;
const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(ip: string): { allowed: boolean; retryAfterSeconds: number } {
  const nowMs = Date.now();
  const entry = hits.get(ip);
  if (!entry || nowMs > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: nowMs + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  entry.count += 1;
  if (entry.count > MAX_REQ) return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - nowMs) / 1000) };
  return { allowed: true, retryAfterSeconds: 0 };
}

export function safeFilename(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 120);
  return base || 'file';
}

export function guardPath(baseDir: string, target: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(resolvedBase, target);
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    throw new Error('Path traversal blocked');
  }
  return resolved;
}

export const ALLOWED_UPLOADS: Record<string, string[]> = {
  pdf: ['application/pdf'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  txt: ['text/plain'],
  md: ['text/markdown', 'text/plain', 'text/x-markdown'],
};

export function allowedUpload(filename: string, mime: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const mimes = ALLOWED_UPLOADS[ext];
  if (!mimes) return false;
  // Some browsers send generic/empty mime for txt/md; accept by extension then.
  if (!mime || mime === 'application/octet-stream') return true;
  return mimes.includes(mime.toLowerCase());
}

export function maskKey(key: string | null | undefined): { has_key: boolean; last4: string | null } {
  if (!key) return { has_key: false, last4: null };
  return { has_key: true, last4: key.slice(-4) };
}
