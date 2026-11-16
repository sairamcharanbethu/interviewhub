export function cleanText(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
export function chunkText(text: string, size = 800, overlap = 100): string[] {
  const chunks: string[] = [];
  if (!text) return chunks;
  for (let i = 0; i < text.length; i += size - overlap) {
    chunks.push(text.slice(i, i + size).trim());
    if (i + size >= text.length) break;
  }
  return chunks.filter(Boolean);
}
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}
