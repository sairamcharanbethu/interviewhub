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
  skills: string[];
  employment: Array<{ employer?: string; title?: string; dates?: string; raw: string }>;
  education: Array<{ institution?: string; degree?: string; raw: string }>;
  certifications: string[];
  emails: string[];
  phones: string[];
  extraction_quality: number;
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

export function extractEmployment(text: string): ParsedResume['employment'] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out: ParsedResume['employment'] = [];
  // Date ranges incl. month-qualified ones ("2022-06 to 2026-05", "2020 – Present").
  const dateRe = /(19|20)\d{2}(?:-\d{2})?\s*(?:[-–—]|to)\s*((19|20)\d{2}(?:-\d{2})?|Present|Current)/i;
  // Education lines also carry year ranges ("B.Tech ... 2019-2023") — they
  // are education, not employment.
  const degreeRe = /\b(B\.?Tech|B\.?Sc|B\.?E|M\.?Tech|M\.?Sc|MBA|Master|Bachelor|Ph\.?D|Diploma|B\.?Com)\b/i;
  for (const line of lines) {
    if (degreeRe.test(line)) continue;
    const m = line.match(dateRe);
    if (m && line.length > 8 && line.length < 200) {
      out.push({ dates: m[0], raw: line });
    }
  }
  return out.slice(0, 20);
}

export function extractEducation(text: string): ParsedResume['education'] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const degreeRe = /\b(B\.?Tech|B\.?Sc|B\.?E|M\.?Tech|M\.?Sc|MBA|Master|Bachelor|Ph\.?D|Diploma|B\.?Com)\b/i;
  const out: ParsedResume['education'] = [];
  for (const line of lines) {
    if (degreeRe.test(line) && line.length < 200) out.push({ raw: line });
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
  return { skills, employment, education, certifications: [...certs], emails, phones, extraction_quality: Math.min(100, score) };
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
