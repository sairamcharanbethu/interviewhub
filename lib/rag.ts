// RAG / context engine: chunking + candidate-scoped FTS5 retrieval.
//
// ISOLATION RULE: every retrieval query carries `WHERE candidate_id = ?`
// (plus `application_id` scoping when given). Chunks of another candidate
// are never returned. When nothing matches, callers get an empty list and
// `has_evidence: false` — they must say "no evidence", never invent content.

import { all, get, run, newId } from './db';
import { chunkText } from './parse/text';
import { stripPII, stripInjection } from './ai/prompts';

export type ChunkSourceType = 'resume' | 'jd' | 'star' | 'note';

export interface RagChunk {
  id: string;
  resume_id: string | null;
  application_id: string | null;
  candidate_id: string;
  chunk_text: string;
  chunk_index: number;
  source_type: ChunkSourceType;
  source_id: string | null;
}

export interface RetrieveOptions {
  candidateId: string;
  applicationId?: string | null;
  query: string;
  limit?: number;
  /** Redact emails/phones from returned chunk text (PII setting). */
  redactPii?: boolean;
}

export interface RetrieveResult {
  chunks: RagChunk[];
  has_evidence: boolean;
  /** Explicit marker for callers to surface when nothing matched. */
  no_evidence_message: string | null;
}

export const DEFAULT_CHUNK_SIZE = 800;
export const DEFAULT_CHUNK_OVERLAP = 100;

/** Split text into overlapping chunks (~800 chars, 100 overlap). Pure. */
export function chunkDocument(text: string, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP): string[] {
  return chunkText(text || '', chunkSize, overlap);
}

/** Ensure the optional source_type column exists (older DBs predate it). Idempotent. */
function ensureSourceTypeColumn(): void {
  const cols = all<{ name: string }>(`PRAGMA table_info(document_chunks)`);
  if (!cols.some((c) => c.name === 'source_type')) {
    run(`ALTER TABLE document_chunks ADD COLUMN source_type TEXT NOT NULL DEFAULT 'resume'`);
  }
}

function ftsRowIdFor(chunkId: string): number | null {
  const row = get<{ rowid: number }>(`SELECT rowid FROM document_chunks WHERE id = ?`, chunkId);
  return row?.rowid ?? null;
}

function insertFts(chunkId: string, text: string): void {
  const rowid = ftsRowIdFor(chunkId);
  if (rowid !== null) run(`INSERT INTO document_chunks_fts (rowid, chunk_text) VALUES (?, ?)`, rowid, text);
}

function deleteFts(chunkId: string): void {
  const rowid = ftsRowIdFor(chunkId);
  if (rowid !== null) run(`DELETE FROM document_chunks_fts WHERE rowid = ?`, rowid);
}

export interface StoreChunksOptions {
  candidateId: string;
  resumeId?: string | null;
  applicationId?: string | null;
  sourceType?: ChunkSourceType;
  chunkSize?: number;
  overlap?: number;
}

/**
 * Chunk `text` and store the rows in document_chunks + the FTS5 index.
 * Replaces any previous chunks for the same resume_id / application_id
 * (same source), so re-imports never leave stale chunks behind.
 */
export function storeDocumentChunks(text: string, opts: StoreChunksOptions): string[] {
  ensureSourceTypeColumn();
  const sourceType: ChunkSourceType =
    opts.sourceType || (opts.resumeId ? 'resume' : opts.applicationId ? 'jd' : 'note');
  // Remove stale chunks for the same source (FTS rows first, then the rows).
  if (opts.resumeId) {
    const old = all<{ id: string }>(`SELECT id FROM document_chunks WHERE resume_id = ? AND candidate_id = ?`, opts.resumeId, opts.candidateId);
    for (const o of old) deleteFts(o.id);
    run(`DELETE FROM document_chunks WHERE resume_id = ? AND candidate_id = ?`, opts.resumeId, opts.candidateId);
  } else if (opts.applicationId) {
    const old = all<{ id: string }>(`SELECT id FROM document_chunks WHERE application_id = ? AND candidate_id = ? AND resume_id IS NULL`, opts.applicationId, opts.candidateId);
    for (const o of old) deleteFts(o.id);
    run(`DELETE FROM document_chunks WHERE application_id = ? AND candidate_id = ? AND resume_id IS NULL`, opts.applicationId, opts.candidateId);
  }
  const chunks = chunkDocument(text, opts.chunkSize, opts.overlap);
  const ids: string[] = [];
  chunks.forEach((c, i) => {
    const id = newId('chunk_');
    run(
      `INSERT INTO document_chunks (id, resume_id, application_id, candidate_id, chunk_text, chunk_index, source_type) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id, opts.resumeId ?? null, opts.applicationId ?? null, opts.candidateId, c, i, sourceType,
    );
    insertFts(id, c);
    ids.push(id);
  });
  return ids;
}

/** Delete FTS rows whose chunk row is gone (e.g. after an FK-cascade delete
 * of a candidate/application, which SQLite does not propagate into the
 * standalone FTS5 table). Stale FTS rows are not just dead weight: a later
 * chunk insert can reuse the freed rowid and fail on a UNIQUE violation,
 * rolling back the whole upload. Run after any permanent parent delete. */
export function purgeOrphanFts(): void {
  run(`DELETE FROM document_chunks_fts WHERE rowid NOT IN (SELECT rowid FROM document_chunks)`);
}

/** Delete all chunks (and FTS rows) for a resume or an application, candidate-scoped. */
export function deleteDocumentChunks(opts: { candidateId: string; resumeId?: string; applicationId?: string }): void {
  if (opts.resumeId) {
    const old = all<{ id: string }>(`SELECT id FROM document_chunks WHERE resume_id = ? AND candidate_id = ?`, opts.resumeId, opts.candidateId);
    for (const o of old) deleteFts(o.id);
    run(`DELETE FROM document_chunks WHERE resume_id = ? AND candidate_id = ?`, opts.resumeId, opts.candidateId);
  } else if (opts.applicationId) {
    const old = all<{ id: string }>(`SELECT id FROM document_chunks WHERE application_id = ? AND candidate_id = ?`, opts.applicationId, opts.candidateId);
    for (const o of old) deleteFts(o.id);
    run(`DELETE FROM document_chunks WHERE application_id = ? AND candidate_id = ?`, opts.applicationId, opts.candidateId);
  }
}

function deriveSourceType(row: Record<string, unknown>): ChunkSourceType {
  const stored = row.source_type as string | undefined;
  if (stored === 'resume' || stored === 'jd' || stored === 'star' || stored === 'note') return stored;
  if (row.resume_id) return 'resume';
  if (row.application_id) return 'jd';
  return 'note';
}

function toRagChunk(row: Record<string, unknown>, redactPii: boolean): RagChunk {
  const sourceType = deriveSourceType(row);
  const sourceId = (sourceType === 'resume' ? row.resume_id : sourceType === 'jd' ? row.application_id : row.resume_id || row.application_id) as string | null;
  let text = (row.chunk_text as string) || '';
  if (redactPii) text = stripPII(text);
  return {
    id: row.id as string,
    resume_id: (row.resume_id as string) || null,
    application_id: (row.application_id as string) || null,
    candidate_id: row.candidate_id as string,
    chunk_text: text,
    chunk_index: (row.chunk_index as number) ?? 0,
    source_type: sourceType,
    source_id: sourceId ?? null,
  };
}

/** Tokenize a query for FTS5 MATCH: quote each token, drop FTS syntax chars. */
export function ftsQueryFromText(query: string): string | null {
  const tokens = (query || '')
    .toLowerCase()
    .split(/[^a-z0-9_+#./-]+/i)
    .map((t) => t.replace(/["*()]/g, '').trim())
    .filter((t) => t.length >= 2)
    .slice(0, 10);
  if (!tokens.length) return null;
  return tokens.map((t) => `"${t}"`).join(' OR ');
}

/**
 * Retrieve context for one candidate only. FTS5 MATCH is always scoped by
 * candidate_id; when applicationId is given, JD chunks are restricted to
 * that application while resume chunks (application_id IS NULL) stay in
 * scope — both are still strictly this candidate's data.
 */
export function retrieveContext(opts: RetrieveOptions): RetrieveResult {
  const { candidateId, applicationId, query, limit = 8, redactPii = false } = opts;
  if (!candidateId) return { chunks: [], has_evidence: false, no_evidence_message: 'No evidence: candidate scope is required.' };
  const safeQuery = stripInjection(query || '');
  const ftsQuery = ftsQueryFromText(safeQuery);
  let rows: Record<string, unknown>[] = [];
  if (ftsQuery) {
    const appFilter = applicationId ? `AND (c.application_id = ? OR c.application_id IS NULL)` : '';
    const params: unknown[] = [ftsQuery, candidateId, ...(applicationId ? [applicationId] : []), limit];
    rows = all<Record<string, unknown>>(
      `SELECT c.id, c.resume_id, c.application_id, c.candidate_id, c.chunk_text, c.chunk_index, c.source_type, f.rank AS fts_rank
       FROM document_chunks_fts f
       JOIN document_chunks c ON c.rowid = f.rowid
       WHERE f.chunk_text MATCH ? AND c.candidate_id = ? ${appFilter}
       ORDER BY f.rank LIMIT ?`,
      ...params,
    );
  }
  // Fallback to scoped LIKE when FTS yields nothing (e.g. short/special terms).
  if (!rows.length) {
    const like = `%${safeQuery.trim().replace(/[%_]/g, '')}%`;
    if (safeQuery.trim().length >= 2) {
      const appFilter = applicationId ? `AND (application_id = ? OR application_id IS NULL)` : '';
      rows = all<Record<string, unknown>>(
        `SELECT id, resume_id, application_id, candidate_id, chunk_text, chunk_index, source_type FROM document_chunks WHERE candidate_id = ? ${appFilter} AND chunk_text LIKE ? LIMIT ?`,
        candidateId, ...(applicationId ? [applicationId] : []), like, limit,
      );
    }
  }
  // Deduplicate by chunk text, keep FTS rank order.
  const seen = new Set<string>();
  const chunks: RagChunk[] = [];
  for (const r of rows) {
    const text = (r.chunk_text as string) || '';
    if (seen.has(text)) continue;
    seen.add(text);
    chunks.push(toRagChunk(r, redactPii));
    if (chunks.length >= limit) break;
  }
  return {
    chunks,
    has_evidence: chunks.length > 0,
    no_evidence_message: chunks.length ? null : 'No evidence: nothing in this candidate\u2019s documents matches the query.',
  };
}

/** All chunks for a candidate's resume (for full-context prompts), candidate-scoped. */
export function getResumeChunks(candidateId: string, resumeId?: string | null, limit = 12): RagChunk[] {
  const rows = resumeId
    ? all<Record<string, unknown>>(`SELECT * FROM document_chunks WHERE candidate_id = ? AND resume_id = ? ORDER BY chunk_index ASC LIMIT ?`, candidateId, resumeId, limit)
    : all<Record<string, unknown>>(`SELECT * FROM document_chunks WHERE candidate_id = ? AND resume_id IS NOT NULL ORDER BY chunk_index ASC LIMIT ?`, candidateId, limit);
  return rows.map((r) => toRagChunk(r, false));
}
