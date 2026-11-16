import { cleanText } from './text';
import { SKILL_KEYWORDS } from './resume';

export interface ParsedJD {
  /** Inferred from the posting text — null when the posting does not state it. Never invented. */
  company: string | null;
  title: string | null;
  location: string | null;
  employment_type: string | null;
  required_skills: string[];
  preferred_skills: string[];
  languages: string[];
  frameworks: string[];
  tools: string[];
  cloud: string[];
  responsibilities: string[];
  experience_years: number | null;
  education: string[];
  certifications: string[];
  keywords: string[];
}

const LANGUAGES = ['Python', 'Java', 'JavaScript', 'TypeScript', 'Go', 'Rust', 'C++', 'C#', 'PL/SQL', 'SQL', 'Bash', 'Shell'];
const FRAMEWORKS = ['React', 'Next.js', 'Spring', 'Spring Boot', 'Django', 'Flask', 'FastAPI', 'Angular', 'Vue', 'Node.js'];
const TOOLS = ['Docker', 'Kubernetes', 'Terraform', 'Jenkins', 'Git', 'Kafka', 'Ansible', 'Prometheus', 'Grafana', 'Jira'];
const CLOUD = ['AWS', 'Azure', 'GCP', 'Oracle Cloud', 'OCI'];

function sectionLines(text: string, headingRe: RegExp): string[] {
  const lines = text.split('\n');
  const out: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (headingRe.test(line)) { inSection = true; continue; }
    // A new heading ends the section: a bare "Heading" line, or a
    // "Heading: ..." line (e.g. "Education: Bachelor's degree ...").
    if (inSection && (/^[A-Z][A-Za-z ]{2,30}:?\s*$/.test(line) || /^[A-Z][A-Za-z ]{2,30}:\s/.test(line))) break;
    if (inSection && line.trim()) out.push(line.trim());
  }
  return out;
}

const ROLE_NOUN_RE = /\b(DBA|Database Administrator|Engineer|Developer|Analyst|Manager|Consultant|Architect|Administrator|Designer|Specialist|Lead|Scientist|Coordinator)\b/i;
const LOCATION_SUFFIX_RE = /^(Remote(?:\s*\([^)]+\))?|[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}|[A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+)$/;

function stripLocationSuffix(line: string): string {
  for (const sep of [' — ', ' – ', ' · ', ' | ']) {
    const idx = line.indexOf(sep);
    if (idx > 0) {
      const suffix = line.slice(idx + sep.length).trim();
      if (LOCATION_SUFFIX_RE.test(suffix)) return line.slice(0, idx).trim();
    }
  }
  return line.trim();
}

/**
 * Infer company / title / location / employment type from a job posting.
 * Every field is nullable: when the posting does not state it, the field
 * stays null so the form leaves it blank instead of inventing a value.
 */
export function inferCompanyTitle(raw: string): { company: string | null; title: string | null; location: string | null; employment_type: string | null } {
  const text = cleanText(raw);
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let company: string | null = null;
  let title: string | null = null;
  let location: string | null = null;

  for (const line of lines.slice(0, 10)) {
    let m = line.match(/^(?:job title|position|role)\s*:\s*(.+)$/i);
    if (m && !title) { title = m[1].replace(/\.$/, '').trim(); continue; }
    m = line.match(/^(?:company|employer|organisation|organization)\s*:\s*(.+)$/i);
    if (m && !company) { company = m[1].replace(/\.$/, '').trim(); continue; }
    m = line.match(/^location\s*:\s*(.+)$/i);
    if (m && !location) { location = m[1].replace(/\.$/, '').trim(); continue; }
  }

  if (!title) {
    for (const line of lines.slice(0, 8)) {
      const m = line.match(/we are (?:hiring|looking for)\s+(?:an?|the)?\s*(.+)$/i);
      if (m) {
        let t = m[1].split(/\s+to\s+(?:support|join|work|help|lead|manage|build)\b/i)[0].trim();
        t = t.replace(/\.$/, '').trim();
        if (ROLE_NOUN_RE.test(t) && t.length < 120) { title = t; break; }
      }
      if (/^about\b/i.test(line) || /^we are\b/i.test(line)) continue;
      if (ROLE_NOUN_RE.test(line) && line.length < 120) { title = stripLocationSuffix(line); break; }
    }
  }

  if (!company) {
    for (const line of lines.slice(0, 8)) {
      let m = line.match(/^about\s+([A-Z][\w&.' -]{1,60}?)(?:\s+(?:is|—|–|-|\||,)|$)/i);
      if (m && !/^the\s/i.test(m[1]) && !ROLE_NOUN_RE.test(m[1])) { company = m[1].trim(); break; }
      m = line.match(/^(.+?)\s+(?:is hiring|is looking for|are hiring|are looking for)\b/);
      if (m && !/^we\b/i.test(m[1])) { company = m[1].trim(); break; }
      m = line.match(/^(?:role|position|job)\s+at\s+(.+)$/i);
      if (m) { company = stripLocationSuffix(m[1]); break; }
      // LinkedIn-style "Company · Location" header line.
      if (line.includes('·')) {
        const [left, right] = line.split('·').map((s) => s.trim());
        if (left && right && !ROLE_NOUN_RE.test(left) && LOCATION_SUFFIX_RE.test(right)) { company = left; if (!location) location = right; break; }
      }
      // "Company — Remote (Canada)" / "Company — Toronto, ON" header line.
      m = line.match(/^([A-Z][\w &.'-]{2,60})\s+[-–—]\s+(.+)$/);
      if (m && !ROLE_NOUN_RE.test(m[1]) && LOCATION_SUFFIX_RE.test(m[2].trim())) {
        company = m[1].trim(); if (!location) location = m[2].trim(); break;
      }
    }
  }

  if (!location) {
    for (const line of lines.slice(0, 10)) {
      const m = line.match(/\b(Remote(?:\s*\([^)]+\))?)\b/);
      if (m) { location = m[1]; break; }
      const c = line.match(/([A-Z][A-Za-z .'-]+?),\s*([A-Z]{2})\b/);
      if (c && !ROLE_NOUN_RE.test(line)) { location = `${c[1].trim()}, ${c[2]}`; break; }
    }
  }

  const typeOrder: Array<[RegExp, string]> = [
    [/\bfull[- ]time\b/i, 'Full-time'], [/\bpart[- ]time\b/i, 'Part-time'],
    [/\bcontract\b/i, 'Contract'], [/\btemporary\b/i, 'Temporary'],
    [/\binternship\b/i, 'Internship'], [/\bhybrid\b/i, 'Hybrid'],
    [/\bremote\b/i, 'Remote'], [/\bon[- ]site\b/i, 'On-site'],
  ];
  let employment_type: string | null = null;
  for (const [re, label] of typeOrder) {
    if (re.test(text.slice(0, 4000))) { employment_type = label; break; }
  }
  return { company, title, location, employment_type };
}

export function parseJD(raw: string): ParsedJD {
  const text = cleanText(raw);
  const lower = text.toLowerCase();
  const matchList = (list: string[]) => list.filter((k) => new RegExp(`(?<![A-Za-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'i').test(lower));
  const requiredLines = sectionLines(text, /(required|must have|qualifications|requirements)/i);
  const preferredLines = sectionLines(text, /(preferred|nice to have|bonus|plus)/i);
  const requiredText = requiredLines.join(' ') || text;
  const preferredText = preferredLines.join(' ');
  const expMatch = text.match(/(\d+)\+?\s*(?:years?|yrs?)\s*(?:of)?\s*(?:experience|exp)/i) || text.match(/experience.{0,20}(\d+)\+?\s*years?/i);
  // Anchored to a heading line: an unanchored /role/ matched "About the role"
  // and swallowed the intro paragraph as "responsibilities".
  const respLines = sectionLines(text, /^\s*(responsibilities|the role|what you'?ll do|duties)\s*:?\s*$/i).slice(0, 15);
  const edu: string[] = [];
  const eduMatch = text.match(/(Bachelor'?s|Master'?s|B\.?Tech|M\.?Tech|B\.?Sc|M\.?Sc|MBA|Ph\.?D)[^.\n]{0,80}/gi);
  if (eduMatch) edu.push(...eduMatch.slice(0, 5));
  const certs: string[] = [];
  for (const m of text.matchAll(/(AWS Certified[^,\n]{0,50}|Oracle Certified[^,\n]{0,50}|PMP|ITIL|CISSP)/gi)) certs.push(m[0].trim());
  const keywords = [...new Set(matchList(SKILL_KEYWORDS))];
  const inferred = inferCompanyTitle(text);
  return {
    company: inferred.company,
    title: inferred.title,
    location: inferred.location,
    employment_type: inferred.employment_type,
    required_skills: [...new Set(matchList(SKILL_KEYWORDS).filter((k) => requiredText.toLowerCase().includes(k.toLowerCase())))],
    preferred_skills: [...new Set(matchList(SKILL_KEYWORDS).filter((k) => preferredText.toLowerCase().includes(k.toLowerCase())))],
    languages: matchList(LANGUAGES),
    frameworks: matchList(FRAMEWORKS),
    tools: matchList(TOOLS),
    cloud: matchList(CLOUD),
    responsibilities: respLines,
    experience_years: expMatch ? parseInt(expMatch[1], 10) : null,
    education: edu,
    certifications: [...new Set(certs)],
    keywords,
  };
}
