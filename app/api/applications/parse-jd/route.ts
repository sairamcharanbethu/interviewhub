export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { handleError, ApiError } from '@/lib/errors';
import { parseJD } from '@/lib/parse/jd';
import { fetchUrlText } from '@/lib/parse/fetch-url';
import { extractTextByMime } from '@/lib/parse/resume';
import { cleanText } from '@/lib/parse/text';

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * JD-first parsing: paste JD text, give a job URL, or upload a JD file and
 * get the parsed requirements plus inferred company/title/location/type
 * back WITHOUT creating anything. The caller shows the draft for review
 * and only then creates the application.
 */
export async function POST(req: Request) {
  try {
    let jdText = '';
    let jobUrl: string | null = null;
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      const textField = form.get('jd_text');
      if (file && typeof file !== 'string') {
        const f = file as File;
        if (f.size === 0) throw new ApiError(400, 'Uploaded file is empty');
        if (f.size > MAX_BYTES) throw new ApiError(413, 'File exceeds 10MB limit');
        jdText = await extractTextByMime(Buffer.from(await f.arrayBuffer()), f.type, f.name);
      } else if (textField) jdText = String(textField);
      const urlField = form.get('job_url') || form.get('url');
      if (!jdText && urlField) { jobUrl = String(urlField); jdText = await fetchUrlText(jobUrl); }
    } else {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      if (typeof body.jd_text === 'string') jdText = body.jd_text;
      else if (typeof body.job_url === 'string' || typeof body.url === 'string') {
        jobUrl = String(body.job_url || body.url);
        jdText = await fetchUrlText(jobUrl);
      }
    }
    jdText = cleanText(jdText);
    if (!jdText) throw new ApiError(400, 'JD text is empty — paste the job description text, upload a JD file, or provide an accessible job URL.');
    const parsed = parseJD(jdText);
    return NextResponse.json({
      parsed,
      jd_text: jdText,
      draft: { company: parsed.company, title: parsed.title, location: parsed.location, employment_type: parsed.employment_type, job_url: jobUrl },
    });
  } catch (e) { return handleError(e); }
}
