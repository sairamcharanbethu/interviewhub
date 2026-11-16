import path from 'path';

const WINDOW_MS = 60_000;
const MAX_REQ = 100;
/** Hard cap on tracked IPs so the limiter cannot grow without bound. */
const MAX_IPS = 1000;
const hits = new Map<string, { count: number; resetAt: number }>();

/**
 * Bounded per-IP rate limiter: 100 requests / minute / IP.
 * Expired entries are swept on insert; if the map is still over the 1000-IP
 * cap, the oldest entries are evicted first (insertion-ordered Map).
 */
export function rateLimitIp(ip: string): { allowed: boolean; retryAfterSeconds: number } {
  const nowMs = Date.now();
  const entry = hits.get(ip);
  if (!entry || nowMs > entry.resetAt) {
    for (const [k, v] of hits) {
      if (nowMs > v.resetAt) hits.delete(k);
    }
    while (hits.size >= MAX_IPS) {
      const oldest = hits.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      hits.delete(oldest);
    }
    hits.set(ip, { count: 1, resetAt: nowMs + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  entry.count += 1;
  if (entry.count > MAX_REQ) return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - nowMs) / 1000) };
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Number of IPs currently tracked by rateLimitIp (for tests/monitoring). */
export function rateLimitStoreSize(): number {
  return hits.size;
}

/** Test/support helper: clear all rate-limit state. */
export function resetRateLimits(): void {
  hits.clear();
}

export function rateLimit(ip: string): { allowed: boolean; retryAfterSeconds: number } {
  return rateLimitIp(ip);
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

export type UploadValidation =
  | { ok: true; kind: 'pdf' | 'docx' | 'txt' | 'md' }
  | { ok: false; error: string };

/**
 * Validate uploaded file *bytes* against the claimed filename (and, when
 * supplied, the MIME type). Checks magic bytes / structure, not just the
 * extension, so a renamed .exe or .txt cannot pass as a PDF/DOCX:
 * - PDF: must start with `%PDF`.
 * - DOCX: must start with the ZIP local-file header `PK\x03\x04` AND be a
 *   parseable-looking ZIP containing `[Content_Types].xml` (minimal scan:
 *   header + literal entry-name bytes, no new deps).
 * - TXT/MD: must decode as valid UTF-8 (TextDecoder fatal:true).
 * - Empty buffers and disallowed extensions are rejected; extension/MIME
 *   consistency is enforced via allowedUpload() when a MIME is supplied.
 */
export function validateUploadBytes(
  filename: string,
  bytes: Buffer,
  mime?: string,
): UploadValidation {
  if (!bytes || bytes.length === 0) return { ok: false, error: 'Uploaded file is empty' };
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (!ALLOWED_UPLOADS[ext]) return { ok: false, error: 'Only pdf, docx, txt, md files are allowed' };
  if (mime !== undefined && !allowedUpload(filename, mime)) {
    return { ok: false, error: 'File extension and MIME type do not match an allowed upload type' };
  }
  if (ext === 'pdf') {
    if (bytes.length < 4 || bytes.subarray(0, 4).toString('latin1') !== '%PDF') {
      return { ok: false, error: 'Invalid PDF file (missing %PDF header)' };
    }
    return { ok: true, kind: 'pdf' };
  }
  if (ext === 'docx') {
    const hasZipHeader =
      bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
    if (!hasZipHeader) return { ok: false, error: 'Invalid DOCX file (missing ZIP header)' };
    if (!bytes.includes(Buffer.from('[Content_Types].xml', 'latin1'))) {
      return { ok: false, error: 'Invalid DOCX file (not a Word document package)' };
    }
    return { ok: true, kind: 'docx' };
  }
  // txt / md: must be valid UTF-8.
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, error: 'File is not valid UTF-8 text' };
  }
  return { ok: true, kind: ext as 'txt' | 'md' };
}
