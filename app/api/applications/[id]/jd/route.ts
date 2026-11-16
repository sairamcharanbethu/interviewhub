export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get, run, now } from '@/lib/db';
import { handleError, notFound, ApiError } from '@/lib/errors';
import { parseJD } from '@/lib/parse/jd';
import { cleanText } from '@/lib/parse/text';
import { fetchUrlText } from '@/lib/parse/fetch-url';
import { extractTextByMime } from '@/lib/parse/resume';
import { validateUploadBytes } from '@/lib/security';
import { serializeApplication } from '@/lib/serialize';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const row = get<Record<string, unknown>>(`SELECT * FROM applications WHERE id = ? AND deleted_at IS NULL`, params.id);
    if (!row) throw notFound('Application not found');
    let jdText = '';
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      const textField = form.get('jd_text');
      if (file && typeof file !== 'string') {
        const f = file as File;
        if (f.size === 0) throw new ApiError(400, 'Uploaded file is empty');
        if (f.size > 10 * 1024 * 1024) throw new ApiError(413, 'File exceeds 10MB limit');
        const jdBytes = Buffer.from(await f.arrayBuffer());
        const valid = validateUploadBytes(f.name, jdBytes, f.type);
        if (!valid.ok) throw new ApiError(400, valid.error);
        jdText = await extractTextByMime(jdBytes, f.type, f.name);
      } else if (textField) jdText = String(textField);
      const urlField = form.get('job_url') || form.get('url');
      if (!jdText && urlField) jdText = await fetchUrlText(String(urlField));
    } else {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      if (typeof body.jd_text === 'string') jdText = body.jd_text;
      else if (typeof body.job_url === 'string' || typeof body.url === 'string') jdText = await fetchUrlText(String(body.job_url || body.url));
    }
    jdText = cleanText(jdText);
    if (!jdText) throw new ApiError(400, 'JD text is empty — paste the job description text or provide an accessible job URL.');
    const parsed = parseJD(jdText);
    run(`UPDATE applications SET jd_text = ?, jd_parsed = ?, updated_at = ? WHERE id = ?`, jdText, JSON.stringify(parsed), now(), params.id);
    // Chunk the JD into document_chunks + FTS5 (candidate-scoped) so the
    // RAG engine can retrieve JD requirements alongside resume evidence.
    const { storeDocumentChunks } = await import('@/lib/rag');
    storeDocumentChunks(jdText, { candidateId: row.candidate_id as string, applicationId: params.id, sourceType: 'jd' });
    const u = get<Record<string, unknown>>(`SELECT * FROM applications WHERE id = ?`, params.id)!;
    return NextResponse.json({ application: serializeApplication(u), jd_parsed: parsed });
  } catch (e) { return handleError(e); }
}
