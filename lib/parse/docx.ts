import mammoth from 'mammoth';
import { cleanText } from './text';

export async function extractDocxText(buf: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: buf });
  return cleanText(result.value || '');
}
