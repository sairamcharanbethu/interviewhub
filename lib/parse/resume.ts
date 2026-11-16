import { cleanText } from './text';

export const SKILL_KEYWORDS = [
  'Oracle', 'Oracle RAC', 'Oracle Data Guard', 'Oracle ASM', 'Oracle GoldenGate', 'PL/SQL', 'SQL',
  'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Kubernetes', 'Docker', 'Terraform', 'AWS', 'Azure',
  'GCP', 'Python', 'Java', 'JavaScript', 'TypeScript', 'Go', 'Rust', 'C++', 'C#', 'Node.js',
  'React', 'Next.js', 'Spring', 'Spring Boot', 'Kafka', 'RabbitMQ', 'Linux', 'Unix', 'Shell',
  'Bash', 'Git', 'CI/CD', 'Jenkins', 'Ansible', 'Prometheus', 'Grafana', 'Snowflake', 'Databricks',
  'Spark', 'Airflow', 'ETL', 'Data Warehouse', 'RPA', 'UiPath', 'Automation Anywhere', 'Workato',
  'Zapier', 'Boomi', 'REST', 'GraphQL', 'Microservices', 'Agile', 'Scrum', 'Jira', 'Confluence',
  'Oracle Cloud', 'OCI', 'Oracle DBA', 'Cloud DBA', 'Database Administration', 'Performance Tuning',
  'Backup and Recovery', 'RMAN', 'Data Pump', 'Exadata', 'VMware', 'Networking', 'Security',
  'HTML', 'CSS', 'Angular', 'Vue', 'Django', 'Flask', 'FastAPI', 'Pandas', 'NumPy', 'Machine Learning',
];

const CERT_PATTERNS = [
  /AWS Certified[^,\n]{0,60}/gi, /Oracle Certified[^,\n]{0,60}/gi, /OCA|OCP|OCM/gi,
  /Microsoft Certified[^,\n]{0,60}/gi, /Google Cloud[^,\n]{0,40}Certif[^,\n]{0,40}/gi,
  /Certified Kubernetes[^,\n]{0,40}/gi, /PMP/gi, /ITIL/gi, /CompTIA[^,\n]{0,40}/gi,
  /CISSP/gi, /Scrum Master[^,\n]{0,30}/gi,
];

export interface ParsedResume {
  /** Person name, taken from the resume header — null when it cannot be found. Never invented. */
  name: string | null;
  location: string | null;
  headline: string | null;
  summary: string | null;
  total_experience_years: number | null;
  skills: string[];
  employment: Array<{ employer?: string; title?: string; dates?: string; raw: string }>;
  education: Array<{ institution?: string; degree?: string; raw: string }>;
  certifications: string[];
  emails: string[];
  phones: string[];
  extraction_quality: number;
}

const SECTION_RE = /^(summary|professional summary|profile|objective|skills|technical skills|employment|experience|work experience|education|certifications|projects|achievements|contact|personal information)$/i;
const TITLE_NOUN_RE = /\b(DBA|database administrator|engineer|developer|analyst|manager|consultant|architect|administrator|designer|specialist|lead|scientist|coordinator|technician|support)\b/i;
const DEGREE_RE = /\b(B\.?Tech|B\.?Sc|B\.?E|M\.?Tech|M\.?Sc|MBA|Master'?s|Bachelor'?s|Ph\.?D|Diploma|B\.?Com)\b/i;

function headerLines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** First non-empty line that looks like a person name: 2–4 words, no digits/@, not a section heading. */
export function extractName(text: string): string | null {
  for (const line of headerLines(text).slice(0, 4)) {
    const first = line.split('|')[0].trim();
    if (SECTION_RE.test(first) || /[@\d]/.test(first) || first.includes(',')) continue;
    const words = first.split(/\s+/);
    if (words.length < 2 || words.length > 4) continue;
    if (TITLE_NOUN_RE.test(first)) continue;
    if (words.every((w) => /^[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'’-]*\.?$/.test(w) || /^[A-Z]\.$/.test(w))) return first;
  }
  return null;
}

/** "Location: X" line, or a "City, Province/Country" segment in the header. */
export function extractLocation(text: string): string | null {
  const lines = headerLines(text);
  for (const line of lines.slice(0, 12)) {
    const m = line.match(/^location\s*:\s*(.+)$/i);
    if (m) return m[1].trim();
  }
  const regionRe = /^(Ontario|Quebec|British Columbia|Alberta|Manitoba|Saskatchewan|Nova Scotia|New Brunswick|Newfoundland|Canada|USA|United States|India|California|Texas|New York)$/i;
  for (const line of lines.slice(0, 10)) {
    for (const seg of line.split('|').map((s) => s.trim())) {
      if (/[@\d]/.test(seg)) continue;
      // "City, Province, Country" or "City, ST" — last part must be a region/state code.
      const m = seg.match(/^([A-Z][A-Za-z .'-]+?),\s*(.+)$/);
      if (m) {
        const last = m[2].split(',').map((s) => s.trim()).pop() || '';
        if (regionRe.test(last) || /^[A-Z]{2}$/.test(last)) return seg;
      }
    }
  }
  return null;
}

/** First title-like line in the header (contains a role noun, no dates/@). */
export function extractHeadline(text: string): string | null {
  const lines = headerLines(text);
  const dateRe = /(19|20)\d{2}/;
  for (const line of lines.slice(0, 8)) {
    if (SECTION_RE.test(line) || /[@]/.test(line) || dateRe.test(line)) continue;
    for (const seg of line.split('|').map((s) => s.trim())) {
      if (TITLE_NOUN_RE.test(seg) && seg.length > 3 && seg.length < 100) return seg;
    }
    if (TITLE_NOUN_RE.test(line) && line.length < 100) return line;
  }
  return null;
}

/** Paragraph under a Summary/Profile/Objective heading, else the first long paragraph. */
export function extractSummary(text: string): string | null {
  const lines = text.split('\n').map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (/^(professional )?(summary|profile|objective)\s*:?$/i.test(lines[i])) {
      const out: string[] = [];
      for (let j = i + 1; j < lines.length && out.join(' ').length < 800; j++) {
        if (SECTION_RE.test(lines[j])) break;
        if (lines[j]) out.push(lines[j]);
        else if (out.length) break;
      }
      if (out.length) return out.join(' ').slice(0, 800);
    }
  }
  // Fallback: first long sentence-bearing paragraph after the header block.
  const body = lines.slice(6).filter(Boolean);
  const para: string[] = [];
  for (const line of body) {
    if (SECTION_RE.test(line)) break;
    if (/^[•\-*]/.test(line)) continue;
    para.push(line);
    if (para.join(' ').length > 120) break;
  }
  const joined = para.join(' ');
  return joined.length > 80 ? joined.slice(0, 800) : null;
}

export function extractSkills(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const kw of SKILL_KEYWORDS) {
    // word-boundary-ish match; keep original casing from dictionary
    const re = new RegExp(`(?<![A-Za-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'i');
    if (re.test(lower)) found.push(kw);
  }
  return [...new Set(found)];
}

const DATE_RANGE_RE = /(19|20)\d{2}(?:-(?:0[1-9]|1[0-2]))?\s*(?:[-–—]|to)\s*((19|20)\d{2}(?:-(?:0[1-9]|1[0-2]))?|Present|Current)/i;

function rangeYears(m: RegExpMatchArray): number | null {
  const start = m[0].match(/^(19|20)\d{2}(?:-(0[1-9]|1[0-2]))?/);
  if (!start) return null;
  const sy = parseInt(start[0].slice(0, 4), 10);
  const sm = start[0].includes('-') ? parseInt(start[0].slice(5, 7), 10) : 1;
  const endPart = m[2] || m[0];
  let ey: number; let em: number;
  if (/present|current/i.test(endPart)) { const d = new Date(); ey = d.getFullYear(); em = d.getMonth() + 1; }
  else {
    const em2 = endPart.match(/((19|20)\d{2})(?:-(0[1-9]|1[0-2]))?/);
    if (!em2) return null;
    ey = parseInt(em2[1], 10);
    em = em2[3] ? parseInt(em2[3], 10) : 12;
  }
  const months = (ey * 12 + em) - (sy * 12 + sm);
  return months > 0 ? Math.round((months / 12) * 10) / 10 : null;
}

/** Longest employment date range, or an explicit "X+ years" statement — never invented. */
export function extractTotalExperience(text: string, employment: ParsedResume['employment']): number | null {
  let best: number | null = null;
  for (const e of employment) {
    const m = (e.dates || e.raw).match(DATE_RANGE_RE);
    if (m) { const y = rangeYears(m); if (y != null && (best == null || y > best)) best = y; }
  }
  const stated = text.match(/(\d+(?:\.\d+)?)\+?\s*years?\s*(?:of\s+)?(?:experience|exp)/i);
  if (stated) { const y = parseFloat(stated[1]); if (best == null || y > best) best = y; }
  return best;
}

function splitTitleEmployer(rest: string, prevTitle: string | null): { title?: string; employer?: string } {
  const parts = rest.split(/\s*[-–—|]\s*/).map((s) => s.trim()).filter(Boolean);
  // "Employer | Title" order: the title-like segment comes second.
  if (parts.length >= 2 && TITLE_NOUN_RE.test(parts[1]) && !TITLE_NOUN_RE.test(parts[0])) {
    return { title: parts[1], employer: parts[0] };
  }
  if (prevTitle && parts.length >= 1) {
    const firstSeg = parts[0].split(',')[0].trim();
    if (!TITLE_NOUN_RE.test(firstSeg)) return { title: prevTitle, employer: firstSeg };
  }
  if (parts.length >= 2) {
    const first = parts[0];
    if (first.includes(',')) {
      const segs = first.split(',').map((s) => s.trim()).filter(Boolean);
      if (segs.length >= 2) return { title: segs[0], employer: segs[1] };
    }
    return { title: parts[0], employer: parts[1] };
  }
  const segs = rest.split(',').map((s) => s.trim()).filter(Boolean);
  if (segs.length >= 2) return { title: segs[0], employer: segs[1] };
  if (prevTitle) return { title: prevTitle, employer: segs[0] || rest };
  return { employer: rest };
}

export function extractEmployment(text: string): ParsedResume['employment'] {
  const lines = headerLines(text);
  const out: ParsedResume['employment'] = [];
  let prevTitle: string | null = null;
  for (const line of lines) {
    const isBullet = /^[•\-*]\s/.test(line);
    if (!isBullet && TITLE_NOUN_RE.test(line) && !DATE_RANGE_RE.test(line) && !SECTION_RE.test(line) && line.length < 100) {
      prevTitle = line.split(/[,|]/)[0].trim();
    }
    if (DEGREE_RE.test(line)) { prevTitle = null; continue; }
    const m = line.match(DATE_RANGE_RE);
    if (m && line.length > 8 && line.length < 220) {
      const rest = line.replace(DATE_RANGE_RE, '').replace(/[\s,•\-–—|]+$/g, '').replace(/^[\s,•\-–—|]+/g, '').trim();
      const { title, employer } = rest ? splitTitleEmployer(rest, prevTitle) : { title: prevTitle || undefined, employer: undefined };
      out.push({ employer, title, dates: m[0], raw: line });
      prevTitle = null;
    } else if (!isBullet && SECTION_RE.test(line)) {
      prevTitle = null;
    }
  }
  return out.slice(0, 20);
}

export function extractEducation(text: string): ParsedResume['education'] {
  const lines = headerLines(text);
  const out: ParsedResume['education'] = [];
  for (const line of lines) {
    if (DEGREE_RE.test(line) && line.length < 220) {
      const segs = line.split(',').map((s) => s.trim()).filter(Boolean);
      const degree = segs[0] && DEGREE_RE.test(segs[0]) ? segs[0] : undefined;
      const institution = segs.find((s) => /Institute|University|College|School|Academy/i.test(s));
      out.push({ institution, degree, raw: line });
    }
  }
  return out.slice(0, 10);
}

export function parseResume(text: string): ParsedResume {
  const cleaned = cleanText(text);
  const skills = extractSkills(cleaned);
  const employment = extractEmployment(cleaned);
  const education = extractEducation(cleaned);
  const certs = new Set<string>();
  for (const re of CERT_PATTERNS) {
    for (const m of cleaned.matchAll(re)) certs.add(m[0].trim());
  }
  const emails = [...new Set(cleaned.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])];
  const phones = [...new Set(cleaned.match(/\+?1?[-.\s()]*\d{3}[-.\s()]*\d{3}[-.\s()]*\d{4}/g) || [])];
  // Quality: length + presence of contact/skills/employment/education signals
  let score = 0;
  if (cleaned.length > 500) score += 30; else if (cleaned.length > 100) score += 15;
  if (emails.length) score += 10;
  if (skills.length >= 5) score += 25; else score += skills.length * 4;
  if (employment.length) score += 15;
  if (education.length) score += 10;
  if (certs.size) score += 10;
  if (extractName(cleaned)) score += 5;
  return {
    name: extractName(cleaned),
    location: extractLocation(cleaned),
    headline: extractHeadline(cleaned),
    summary: extractSummary(cleaned),
    total_experience_years: extractTotalExperience(cleaned, employment),
    skills, employment, education, certifications: [...certs], emails, phones,
    extraction_quality: Math.min(100, score),
  };
}

export async function extractTextByMime(buf: Buffer, mime: string, filename: string): Promise<string> {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'pdf' || mime === 'application/pdf') {
    const { extractPdfText } = await import('./pdf');
    return extractPdfText(buf);
  }
  if (ext === 'docx') {
    const { extractDocxText } = await import('./docx');
    return extractDocxText(buf);
  }
  return cleanText(buf.toString('utf8'));
}
