export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { all, get, run, newId, transaction } from '@/lib/db';
import { handleError, notFound, ApiError } from '@/lib/errors';
import { allowedUpload } from '@/lib/security';
import { saveUpload } from '@/lib/files';
import { extractTextByMime, parseResume } from '@/lib/parse/resume';
import { storeDocumentChunks } from '@/lib/rag';
import { serializeResume } from '@/lib/serialize';

const MAX_BYTES = 10 * 1024 * 1024;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const cand = get(`SELECT id FROM candidates WHERE id = ? AND deleted_at IS NULL`, params.id);
    if (!cand) throw notFound('Candidate not found');
    const rows = all<Record<string, unknown>>(`SELECT * FROM resumes WHERE candidate_id = ? ORDER BY version DESC, created_at DESC`, params.id);
    return NextResponse.json({ resumes: rows.map(serializeResume) });
  } catch (e) { return handleError(e); }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const cand = get<Record<string, unknown>>(`SELECT * FROM candidates WHERE id = ? AND deleted_at IS NULL`, params.id);
    if (!cand) throw notFound('Candidate not found');
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') throw new ApiError(400, 'No file uploaded (field: file)');
    const f = file as File;
    if (f.size === 0) throw new ApiError(400, 'Uploaded file is empty');
    if (f.size > MAX_BYTES) throw new ApiError(413, 'File exceeds 10MB limit');
    if (!allowedUpload(f.name, f.type)) throw new ApiError(400, 'Only pdf, docx, txt, md files are allowed');
    const bytes = Buffer.from(await f.arrayBuffer());
    const { storedPath } = await saveUpload(params.id, f.name, bytes);
    const extractedText = await extractTextByMime(bytes, f.type, f.name);
    const parsed = parseResume(extractedText);
    const prev = get<{ maxv: number | null }>(`SELECT MAX(version) AS maxv FROM resumes WHERE candidate_id = ?`, params.id);
    const version = (prev?.maxv ?? 0) + 1;
    const rid = newId('resume_');
    transaction(() => {
      run(`UPDATE resumes SET is_active = 0 WHERE candidate_id = ?`, params.id);
      run(
        `INSERT INTO resumes (id, candidate_id, filename, stored_path, mime, size_bytes, version, extracted_text, parsed, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        rid, params.id, f.name, storedPath, f.type || null, f.size, version, extractedText, JSON.stringify(parsed),
      );
      storeDocumentChunks(extractedText, { candidateId: params.id, resumeId: rid, sourceType: 'resume' });
    });
    const row = get<Record<string, unknown>>(`SELECT * FROM resumes WHERE id = ?`, rid)!;
    return NextResponse.json({ resume: serializeResume(row) }, { status: 201 });
  } catch (e) { return handleError(e); }
}
