import { cleanText } from './text';
import { SKILL_KEYWORDS } from './resume';

export interface ParsedJD {
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
  return {
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
