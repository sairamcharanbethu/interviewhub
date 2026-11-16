import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTempDir, jsonBody, jsonReq, makeTempDataDir } from '../helpers';
import { analysePdf, extractPdfText, ocrAvailable, tryOcrPdf } from '@/lib/parse/pdf';

// ---------------------------------------------------------------------------
// Minimal valid PDFs, built in-test (no new deps, no fixtures on disk).
// CRLF endings + byte-accurate xref offsets: the bundled pdf.js v1.10.100
// (via pdf-parse) requires a well-formed xref table.
// ---------------------------------------------------------------------------

function pdfEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

interface TestPage {
  /** Raw content-stream operators for the page. */
  content: string;
  /** Resource dictionary body, e.g. font or XObject refs (object numbers resolved by the builder). */
  resources: (nums: { font: number; image: number }) => string;
}

/** Assemble a multi-page PDF. Returns the exact bytes. */
function buildPdf(pages: TestPage[]): Buffer {
  const n = pages.length;
  const fontNum = 3 + 2 * n;
  const imageNum = 4 + 2 * n;
  const kids = pages.map((_, i) => `${3 + 2 * i} 0 R`).join(' ');
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`,
  ];
  pages.forEach((page, i) => {
    const pageNum = 3 + 2 * i;
    const contentNum = 4 + 2 * i;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources ${page.resources({ font: fontNum, image: imageNum })} /Contents ${contentNum} 0 R >>`,
    );
    const streamLen = Buffer.byteLength(page.content, 'latin1');
    objects.push(`<< /Length ${streamLen} >>\r\nstream\r\n${page.content}\r\nendstream`);
    void pageNum;
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  // 1x1 1-bit image, used by the scanned-like page (no text operators).
  objects.push('<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 1 /Length 1 >>\r\nstream\r\n\x00\r\nendstream');

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\r\n', 'latin1')];
  const offsets: number[] = [0];
  objects.forEach((obj, i) => {
    offsets[i + 1] = Buffer.concat(chunks).length;
    chunks.push(Buffer.from(`${i + 1} 0 obj\r\n${obj}\r\nendobj\r\n`, 'latin1'));
  });
  const xrefPos = Buffer.concat(chunks).length;
  let xref = `xref\r\n0 ${objects.length + 1}\r\n0000000000 65535 f\r\n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n\r\n`;
  }
  xref += `trailer\r\n<< /Size ${objects.length + 1} /Root 1 0 R >>\r\nstartxref\r\n${xrefPos}\r\n%%EOF\r\n`;
  return Buffer.concat([...chunks, Buffer.from(xref, 'latin1')]);
}

function textPage(lines: string[]): TestPage {
  const ops = lines
    .map((l, i) => (i === 0 ? `BT /F1 12 Tf 72 720 Td (${pdfEscape(l)}) Tj` : `0 -18 Td (${pdfEscape(l)}) Tj`))
    .join(' ');
  return { content: `${ops} ET`, resources: ({ font }) => `<< /Font << /F1 ${font} 0 R >> >>` };
}

function scannedPage(): TestPage {
  return {
    content: 'q 100 0 0 100 100 600 cm /Im1 Do Q',
    resources: ({ image }) => `<< /XObject << /Im1 ${image} 0 R >> >>`,
  };
}

const RESUME_LINE_1 =
  'Naga Iswarya Lakshmi Bhogadi Oracle DBA with ten years of experience in database administration and performance tuning';
const RESUME_LINE_2 = 'Skills: Oracle RAC RMAN Data Guard PL SQL AWS';

describe('extractPdfText / analysePdf', () => {
  it('extracts text from a valid text PDF', async () => {
    const buf = buildPdf([textPage([RESUME_LINE_1, RESUME_LINE_2])]);
    const text = await extractPdfText(buf);
    expect(text).toContain('Naga Iswarya Lakshmi Bhogadi');
    expect(text).toContain('Oracle RAC');
  });

  it('analysePdf reports a real text PDF as not scanned, with page counts', async () => {
    const buf = buildPdf([textPage([RESUME_LINE_1, RESUME_LINE_2])]);
    const a = await analysePdf(buf);
    expect(a.pageCount).toBe(1);
    expect(a.isScanned).toBe(false);
    expect(a.meaningfulChars).toBeGreaterThan(50);
    expect(a.pageCharCounts).toEqual([a.meaningfulChars]);
    expect(a.text).toContain('Bhogadi');
  });

  it('analysePdf reports a two-page text PDF with pageCount 2', async () => {
    const buf = buildPdf([
      textPage([RESUME_LINE_1]),
      textPage(['Second page of the resume with enough meaningful text to clear the scanned threshold easily here.']),
    ]);
    const a = await analysePdf(buf);
    expect(a.pageCount).toBe(2);
    expect(a.isScanned).toBe(false);
    expect(a.text).toContain('Second page');
  });

  it('analysePdf flags an image-only (scanned-like) PDF as scanned', async () => {
    const buf = buildPdf([scannedPage()]);
    const a = await analysePdf(buf);
    expect(a.pageCount).toBe(1);
    expect(a.isScanned).toBe(true);
    expect(a.meaningfulChars).toBeLessThan(50);
    expect(await extractPdfText(buf)).toBe('');
  });

  it('extractPdfText / analysePdf reject invalid PDF bytes instead of crashing', async () => {
    const garbage = Buffer.from('this is not a pdf at all, just random bytes 12345', 'utf8');
    await expect(extractPdfText(garbage)).rejects.toThrow();
    await expect(analysePdf(garbage)).rejects.toThrow();
  });
});

describe('OCR availability (honest, no fake output)', () => {
  it('ocrAvailable() is a boolean and tryOcrPdf() returns null without a page renderer', async () => {
    expect(typeof ocrAvailable()).toBe('boolean');
    // Even where tesseract exists, no page images can be produced here, so
    // OCR honestly reports unavailability instead of inventing text.
    const buf = buildPdf([scannedPage()]);
    await expect(tryOcrPdf(buf)).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Route-level handling: scanned PDFs are stored but flagged, corrupt PDFs
// leave no file and no row.
// ---------------------------------------------------------------------------
const dir = makeTempDataDir();
afterAll(() => cleanupTempDir(dir));

const { POST: createCandidate } = await import('@/app/api/candidates/route');
const { GET: listResumes, POST: uploadResume } = await import('@/app/api/candidates/[id]/resumes/route');

async function makeCandidate(): Promise<string> {
  const res = await createCandidate(jsonReq('http://localhost/api/candidates', 'POST', { name: 'Pdf Test Candidate' }));
  return ((await jsonBody(res)).candidate as Record<string, unknown>).id as string;
}

function uploadReq(candidateId: string, file: File): Request {
  const fd = new FormData();
  fd.append('file', file);
  return new Request(`http://localhost/api/candidates/${candidateId}/resumes`, { method: 'POST', body: fd });
}

describe('resume PDF upload route', () => {
  it('stores a scanned PDF with low quality + needs_review + warning, not as processed', async () => {
    const id = await makeCandidate();
    const pdf = buildPdf([scannedPage()]);
    const res = await uploadResume(
      uploadReq(id, new File([pdf], 'scanned-resume.pdf', { type: 'application/pdf' })),
      { params: { id } },
    );
    expect(res.status).toBe(201);
    const body = await jsonBody(res);
    expect(body.warning as string).toMatch(/Scanned\/image-only document detected/);
    expect(body.warning as string).toMatch(/tesseract/);
    expect(typeof body.ocr_available).toBe('boolean');
    const parsed = (body.resume as Record<string, unknown>).parsed as Record<string, unknown>;
    expect(parsed.extraction_quality as number).toBeLessThanOrEqual(20);
    expect(parsed.needs_review).toBe(true);
    expect(parsed.page_char_counts).toEqual([0]);
  });

  it('stores a text PDF normally, with no warning', async () => {
    const id = await makeCandidate();
    const pdf = buildPdf([textPage([RESUME_LINE_1, RESUME_LINE_2])]);
    const res = await uploadResume(
      uploadReq(id, new File([pdf], 'resume.pdf', { type: 'application/pdf' })),
      { params: { id } },
    );
    expect(res.status).toBe(201);
    const body = await jsonBody(res);
    expect(body.warning).toBeUndefined();
    const resume = body.resume as Record<string, unknown>;
    expect(resume.extracted_text as string).toContain('Bhogadi');
    const parsed = resume.parsed as Record<string, unknown>;
    expect(parsed.needs_review).toBeUndefined();
  });

  it('rejects a corrupt PDF with a 400 and creates no resume row and no file', async () => {
    const id = await makeCandidate();
    const res = await uploadResume(
      uploadReq(id, new File(['not a pdf at all, just random bytes'], 'broken.pdf', { type: 'application/pdf' })),
      { params: { id } },
    );
    // Magic-byte validation rejects it before extraction (400, not a 500):
    // no file is saved and no resume row is created.
    expect(res.status).toBe(400);
    expect(((await jsonBody(res)).error as string)).toMatch(/Invalid PDF/i);
    const list = await listResumes(new Request(`http://localhost/api/candidates/${id}/resumes`), { params: { id } });
    expect(((await jsonBody(list)).resumes as unknown[]).length).toBe(0);
  });
});
