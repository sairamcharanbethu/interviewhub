import pdfParse from 'pdf-parse';
import { cleanText } from './text';

export async function extractPdfText(buf: Buffer): Promise<string> {
  const data = await pdfParse(buf);
  return cleanText(data.text || '');
}
