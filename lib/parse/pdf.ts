import { execFileSync } from 'child_process';
// Import the implementation file directly, not the package entry:
// pdf-parse's index.js runs a debug self-test at load when required without
// a CommonJS parent, which crashes under vitest. Same function, no side effect.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { cleanText } from './text';

export interface PdfAnalysis {
  text: string;
  pageCharCounts: number[];
  pageCount: number;
  isScanned: boolean;
  meaningfulChars: number;
}

/**
 * pdf-parse bundles pdf.js v1.10.100, whose getDocument() treats ANY object
 * with a `byteLength` as an ArrayBuffer — including a Node Buffer — and then
 * passes it through unconverted. Downstream it reads via the Buffer's backing
 * ArrayBuffer, which for small/pooled Buffers is the shared 8 KiB pool, so
 * every byte offset is wrong and parsing fails with "bad XRef entry" (real
 * large PDFs usually survive only because their Buffers are unpooled).
 * Converting to a plain Uint8Array (element-wise copy) makes parsing correct
 * for every input. Output text for real PDFs is unchanged.
 */
function toPlainBytes(buf: Buffer): Uint8Array {
  return Uint8Array.from(buf);
}

function meaningfulCharCount(text: string): number {
  return text.replace(/\s/g, '').length;
}

export async function extractPdfText(buf: Buffer): Promise<string> {
  // Cast is type-only: at runtime this is a plain Uint8Array, which is what
  // the bundled pdf.js needs (see toPlainBytes above).
  const data = await pdfParse(toPlainBytes(buf) as unknown as Buffer);
  return cleanText(data.text || '');
}

/**
 * Full PDF analysis for scanned/empty detection.
 * pdf-parse returns the whole document text (pages joined with blank lines,
 * no form-feed separators in practice) plus `numpages`. When the text does
 * contain form feeds we split per page; otherwise we report a single bucket
 * holding the whole document's meaningful characters.
 */
export async function analysePdf(buf: Buffer): Promise<PdfAnalysis> {
  const data = await pdfParse(toPlainBytes(buf) as unknown as Buffer);
  const text = cleanText(data.text || '');
  const pageCount = typeof data.numpages === 'number' && data.numpages > 0 ? data.numpages : 1;
  const meaningfulChars = meaningfulCharCount(text);
  let pageCharCounts: number[];
  if (text.includes('\f')) {
    const parts = text.split('\f').map((p) => meaningfulCharCount(p));
    pageCharCounts = parts.slice(0, pageCount);
    while (pageCharCounts.length < pageCount) pageCharCounts.push(0);
  } else {
    pageCharCounts = [meaningfulChars];
  }
  const isScanned =
    meaningfulChars < 50 || (pageCount > 0 && meaningfulChars / pageCount < 20);
  return { text, pageCharCounts, pageCount, isScanned, meaningfulChars };
}

let tesseractCache: boolean | null = null;

/**
 * True when the `tesseract` binary is on PATH. Result is cached for the
 * process lifetime. Never throws — absence is a normal, reportable state.
 */
export function ocrAvailable(): boolean {
  if (tesseractCache !== null) return tesseractCache;
  try {
    execFileSync('which', ['tesseract'], { stdio: 'pipe', timeout: 5000 });
    tesseractCache = true;
  } catch {
    tesseractCache = false;
  }
  return tesseractCache;
}

/**
 * OCR for a scanned/image-only PDF.
 *
 * Honest limitation: turning PDF pages into images needs a renderer
 * (pdftoppm / pdf.js canvas / similar), which is not a guaranteed
 * dependency here, so there is no way to feed tesseract real page images
 * from this module. When tesseract exists but no page images can be
 * produced we return null — callers must report OCR as unavailable rather
 * than inventing text. Never returns fabricated OCR output.
 */
export async function tryOcrPdf(_buf: Buffer): Promise<string | null> {
  if (!ocrAvailable()) return null;
  // No page renderer available: cannot produce images for tesseract.
  return null;
}
