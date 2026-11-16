import { parseJson } from './db';

type Row = Record<string, unknown>;
function j<T>(v: unknown, fb: T): T { return parseJson(typeof v === 'string' ? v : null, fb); }

export function serializeCandidate(r: Row): Row {
  return { ...r, skills: j<string[]>(r.skills, []), employment: j(r.employment, []), education: j(r.education, []), certifications: j<string[]>(r.certifications, []), projects: j(r.projects, []), achievements: j<string[]>(r.achievements, []), is_default: r.is_default === 1 };
}
export function serializeApplication(r: Row): Row {
  return { ...r, recruiter: j(r.recruiter, null), jd_parsed: j(r.jd_parsed, null) };
}
export function serializeResume(r: Row): Row {
  return { ...r, parsed: j(r.parsed, null), is_active: r.is_active === 1 };
}
export function serializeStar(r: Row): Row {
  return { ...r, technologies: j<string[]>(r.technologies, []), skills: j<string[]>(r.skills, []) };
}
export function serializeSession(r: Row): Row {
  return { ...r, questions: j(r.questions, []), answers: j(r.answers, []) };
}
export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'unknown';
}
