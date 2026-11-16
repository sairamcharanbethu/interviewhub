export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { all, get, run, newId, transaction } from '@/lib/db';
import { handleError, notFound, ApiError } from '@/lib/errors';
import { allowedUpload, validateUploadBytes } from '@/lib/security';
import { deleteStoredFile, saveUpload } from '@/lib/files';
import { extractTextByMime, parseResume } from '@/lib/parse/resume';
import { analysePdf, ocrAvailable } from '@/lib/parse/pdf';
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
    // Validate -> extract -> save. Extraction runs BEFORE anything is
    // written to disk or the DB, so a corrupt/unreadable file leaves no
    // orphan file and no resume row (the error below aborts the request).
    const bytes = Buffer.from(await f.arrayBuffer());
    const valid = validateUploadBytes(f.name, bytes, f.type);
    if (!valid.ok) throw new ApiError(400, valid.error);
    let extractedText: string;
    try {
      extractedText = await extractTextByMime(bytes, f.type, f.name);
    } catch {
      throw new ApiError(400, 'Could not extract text from the uploaded file');
    }
    // Scanned/image-only detection: PDFs get a per-page analysis; other
    // types are judged on meaningful (non-whitespace) characters alone.
    const isPdf = f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf';
    let pageCharCounts: number[] | undefined;
    let meaningfulChars = extractedText.replace(/\s/g, '').length;
    let isScanned = meaningfulChars < 50;
    if (isPdf) {
      const analysis = await analysePdf(bytes);
      pageCharCounts = analysis.pageCharCounts;
      meaningfulChars = analysis.meaningfulChars;
      isScanned = analysis.isScanned;
    }
    const { storedPath } = await saveUpload(params.id, f.name, bytes);
    const parsed = parseResume(extractedText);
    // A scanned/empty document is stored, but NEVER marked as successfully
    // processed: quality is capped low and it is flagged for review so the
    // UI (and the user) never treats an empty parse as a real resume.
    const parsedOut: Record<string, unknown> = { ...parsed };
    let warning: string | undefined;
    if (isScanned) {
      parsedOut.extraction_quality = Math.min(parsed.extraction_quality, 20);
      parsedOut.needs_review = true;
      parsedOut.page_char_counts = pageCharCounts ?? [meaningfulChars];
      warning = 'Scanned/image-only document detected — text extraction found almost nothing. Install tesseract (brew install tesseract) for OCR, or paste the text manually.';
    }
    const prev = get<{ maxv: number | null }>(`SELECT MAX(version) AS maxv FROM resumes WHERE candidate_id = ?`, params.id);
    const version = (prev?.maxv ?? 0) + 1;
    const rid = newId('resume_');
    try {
      transaction(() => {
        run(`UPDATE resumes SET is_active = 0 WHERE candidate_id = ?`, params.id);
        run(
          `INSERT INTO resumes (id, candidate_id, filename, stored_path, mime, size_bytes, version, extracted_text, parsed, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          rid, params.id, f.name, storedPath, f.type || null, f.size, version, extractedText, JSON.stringify(parsedOut),
        );
        storeDocumentChunks(extractedText, { candidateId: params.id, resumeId: rid, sourceType: 'resume' });
      });
    } catch (e) {
      // DB insert failed after the file landed: remove the orphan file.
      deleteStoredFile(storedPath);
      throw e;
    }
    const row = get<Record<string, unknown>>(`SELECT * FROM resumes WHERE id = ?`, rid)!;
    const body: Record<string, unknown> = { resume: serializeResume(row) };
    if (warning) {
      body.warning = warning;
      body.ocr_available = ocrAvailable();
    }
    return NextResponse.json(body, { status: 201 });
  } catch (e) { return handleError(e); }
}
