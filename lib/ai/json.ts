// Defensive JSON parsing for AI output. AI responses are untrusted text:
// they may wrap JSON in fences, add preamble/postamble, or be malformed.
// These pure functions never throw — they return null on failure so callers
// can fall back to the deterministic heuristic/template generator.

/** Extract the first balanced {...} or [...] JSON value from raw text. */
export function extractJsonValue(text: string): string | null {
  if (!text) return null;
  // Strip markdown fences first.
  let t = text.replace(/```(?:json)?\s*/gi, '```').trim();
  // Prefer the content inside the first/last fence pair if present.
  const fence = t.match(/```\s*([\s\S]*?)\s*```/);
  if (fence) t = fence[1].trim();
  const startObj = t.indexOf('{');
  const startArr = t.indexOf('[');
  let start = -1;
  let open = '';
  let close = '';
  if (startObj !== -1 && (startArr === -1 || startObj < startArr)) { start = startObj; open = '{'; close = '}'; }
  else if (startArr !== -1) { start = startArr; open = '['; close = ']'; }
  else return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return null;
}

/** Parse AI output into JSON, or null. Never throws. */
export function parseAiJson<T>(text: string): T | null {
  const raw = extractJsonValue(text);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Validate that a parsed value is a non-empty array of objects with required string fields. */
export function isObjectArray(v: unknown): v is Array<Record<string, unknown>> {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'object' && x !== null);
}
