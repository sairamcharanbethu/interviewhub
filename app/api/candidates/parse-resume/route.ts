export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { handleError, ApiError } from '@/lib/errors';
import { allowedUpload } from '@/lib/security';
import { extractTextByMime, parseResume } from '@/lib/parse/resume';
import { cleanText } from '@/lib/parse/text';

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Resume-first parsing: upload a resume and get the parsed profile fields
 * back WITHOUT creating anything. The caller shows the result for review
 * and only then creates the candidate (and attaches this same file as v1).
 */
export async function POST(req: Request) {
  try {
    const ct = req.headers.get('content-type') || '';
    if (!ct.includes('multipart/form-data')) throw new ApiError(400, 'Upload a resume file (field: file)');
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') throw new ApiError(400, 'No file uploaded (field: file)');
    const f = file as File;
    if (f.size === 0) throw new ApiError(400, 'Uploaded file is empty');
    if (f.size > MAX_BYTES) throw new ApiError(413, 'File exceeds 10MB limit');
    if (!allowedUpload(f.name, f.type)) throw new ApiError(400, 'Only pdf, docx, txt, md files are allowed');
    const bytes = Buffer.from(await f.arrayBuffer());
    const extractedText = await extractTextByMime(bytes, f.type, f.name);
    if (!cleanText(extractedText)) throw new ApiError(400, 'No readable text could be extracted from this file — it may be a scanned image or an empty document.');
    const parsed = parseResume(extractedText);
    return NextResponse.json({ parsed, extracted_text: extractedText, quality: parsed.extraction_quality });
  } catch (e) { return handleError(e); }
}
