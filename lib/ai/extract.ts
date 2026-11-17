// AI-first extraction of candidate profiles and job analyses.
// Grounding: only facts supported by the document; unknown → empty/null/
// 'Unknown', never invented. AI output is Zod-validated; on invalid JSON,
// timeout, or failure the heuristic parser (lib/parse) is the fallback,
// labelled origin 'fallback'. Resume/JD text is untrusted data: wrapped in
// delimited blocks with the injection safeguards from lib/ai/prompts.ts.
import { z } from 'zod';
import { completeJsonWithFallback } from './registry';
import { buildStructuredPrompt } from './structured';
import { sanitizeUntrusted } from './prompts';
import { parseResume } from '../parse/resume';
import { parseJD } from '../parse/jd';

export const evidenceSchema = z.object({
  value: z.string(),
  evidence: z.string().default(''),
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
});
export type Grounded<T> = { value: T; evidence: string; confidence: 'high' | 'medium' | 'low' };

const employmentSchema = z.object({
  employer: z.string().nullable().default(null),
  position: z.string().nullable().default(null),
  startDate: z.string().nullable().default(null),
  endDate: z.string().nullable().default(null),
  responsibilities: z.array(z.string()).default([]),
  achievements: z.array(z.string()).default([]),
});
const educationSchema = z.object({
  institution: z.string().nullable().default(null),
  credential: z.string().nullable().default(null),
  field: z.string().nullable().default(null),
  year: z.string().nullable().default(null),
});
const projectSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  technologies: z.array(z.string()).default([]),
});

export const candidateProfileSchema = z.object({
  fullName: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  headline: z.string().nullable().default(null),
  summary: z.string().nullable().default(null),
  totalYearsExperience: z.number().nullable().default(null),
  employment: z.array(employmentSchema).default([]),
  skills: z.object({
    technical: z.array(z.string()).default([]),
    functional: z.array(z.string()).default([]),
    tools: z.array(z.string()).default([]),
  }).default({ technical: [], functional: [], tools: [] }),
  certifications: z.array(z.string()).default([]),
  education: z.array(educationSchema).default([]),
  projects: z.array(projectSchema).default([]),
  measurableAchievements: z.array(z.string()).default([]),
});
export type CandidateProfile = z.infer<typeof candidateProfileSchema>;

export const jobAnalysisSchema = z.object({
  company: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  department: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  employmentType: z.string().nullable().default(null),
  seniority: z.string().nullable().default(null),
  requiredExperience: z.number().nullable().default(null),
  mandatorySkills: z.array(z.string()).default([]),
  preferredSkills: z.array(z.string()).default([]),
  technologies: z.array(z.string()).default([]),
  responsibilities: z.array(z.string()).default([]),
  domainKnowledge: z.array(z.string()).default([]),
  leadershipExpectations: z.array(z.string()).default([]),
  certifications: z.array(z.string()).default([]),
  hiringCriteria: z.array(z.string()).default([]),
  interviewCategories: z.array(z.string()).default([]),
});
export type JobAnalysis = z.infer<typeof jobAnalysisSchema>;

export interface ExtractionOutcome<T> {
  data: T;
  origin: 'ai' | 'fallback';
  providerId: string;
  model: string | null;
  error?: string;
}

function snippetFor(text: string, value: string): string {
  if (!value) return '';
  const idx = text.toLowerCase().indexOf(value.toLowerCase().slice(0, 40));
  if (idx < 0) return '';
  return text.slice(Math.max(0, idx - 80), idx + 160).replace(/\s+/g, ' ').trim();
}

/** Attach {value, evidence, confidence} grounding to the key string facts of a profile. */
export function groundProfile(profile: CandidateProfile, resumeText: string): Record<string, Grounded<string | null>> {
  const g = (v: string | null): Grounded<string | null> => {
    const ev = v ? snippetFor(resumeText, v) : '';
    return { value: v, evidence: ev, confidence: ev ? 'high' : v ? 'low' : 'low' };
  };
  return {
    fullName: g(profile.fullName),
    email: g(profile.email),
    location: g(profile.location),
    headline: g(profile.headline),
    summary: g(profile.summary),
  };
}

export function groundJob(job: JobAnalysis, jdText: string): Record<string, Grounded<string | null>> {
  const g = (v: string | null): Grounded<string | null> => {
    const ev = v ? snippetFor(jdText, v) : '';
    return { value: v, evidence: ev, confidence: ev ? 'high' : v ? 'low' : 'low' };
  };
  return { company: g(job.company), title: g(job.title), location: g(job.location), employmentType: g(job.employmentType) };
}

function heuristicProfile(text: string): CandidateProfile {
  const p = parseResume(text);
  return candidateProfileSchema.parse({
    fullName: p.name,
    email: p.emails[0] ?? null,
    phone: p.phones[0] ?? null,
    location: p.location,
    headline: p.headline,
    summary: p.summary,
    totalYearsExperience: p.total_experience_years,
    employment: p.employment.map((e) => ({
      employer: e.employer ?? null,
      position: e.title ?? null,
      startDate: null,
      endDate: null,
      responsibilities: [],
      achievements: [e.raw].filter(Boolean),
    })),
    skills: { technical: p.skills, functional: [], tools: [] },
    certifications: p.certifications,
    education: p.education.map((e) => ({ institution: e.institution ?? null, credential: e.degree ?? null, field: null, year: null })),
    projects: [],
    measurableAchievements: [],
  });
}

function heuristicJob(text: string): JobAnalysis {
  const j = parseJD(text);
  return jobAnalysisSchema.parse({
    company: j.company,
    title: j.title,
    department: null,
    location: j.location,
    employmentType: j.employment_type,
    seniority: null,
    requiredExperience: j.experience_years,
    mandatorySkills: j.required_skills,
    preferredSkills: j.preferred_skills,
    technologies: j.keywords,
    responsibilities: j.responsibilities,
    domainKnowledge: [],
    leadershipExpectations: [],
    certifications: j.certifications,
    hiringCriteria: j.required_skills,
    interviewCategories: [],
  });
}

export async function extractCandidateProfile(resumeText: string): Promise<ExtractionOutcome<CandidateProfile>> {
  const clean = sanitizeUntrusted(resumeText, 12000);
  const messages = buildStructuredPrompt({
    system: 'You extract structured candidate facts from a resume. Only facts supported by the resume. Unknown fields must be null or empty arrays — never invent names, employers, dates, skills, or metrics.',
    task: 'Extract the candidate profile from the resume below as JSON matching the schema.',
    dataBlocks: [{ label: 'resume', content: clean }],
    schemaHint: JSON.stringify({ fullName: 'string|null', email: 'string|null', phone: 'string|null', location: 'string|null', headline: 'string|null', summary: 'string|null', totalYearsExperience: 'number|null', employment: [{ employer: 'string|null', position: 'string|null', startDate: 'string|null', endDate: 'string|null', responsibilities: ['string'], achievements: ['string'] }], skills: { technical: ['string'], functional: ['string'], tools: ['string'] }, certifications: ['string'], education: [{ institution: 'string|null', credential: 'string|null', field: 'string|null', year: 'string|null' }], projects: [{ name: 'string', description: 'string', technologies: ['string'] }], measurableAchievements: ['string'] }),
  });
  const prompt = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
  const out = await completeJsonWithFallback(prompt, candidateProfileSchema);
  if (out.origin === 'ai' && out.result) {
    return { data: out.result.data as CandidateProfile, origin: 'ai', providerId: out.providerId, model: out.model };
  }
  return { data: heuristicProfile(resumeText), origin: 'fallback', providerId: 'fallback', model: null, error: out.attempts.map((a) => `${a.provider}: ${a.message}`).join('; ') || 'No AI provider available' };
}

export async function extractJobAnalysis(jdText: string): Promise<ExtractionOutcome<JobAnalysis>> {
  const clean = sanitizeUntrusted(jdText, 12000);
  const messages = buildStructuredPrompt({
    system: 'You extract structured job facts from a job description. Only facts supported by the posting. Unknown fields must be null or empty arrays — never invent the company, title, requirements, or skills.',
    task: 'Extract the job analysis from the job description below as JSON matching the schema.',
    dataBlocks: [{ label: 'job-description', content: clean }],
    schemaHint: JSON.stringify({ company: 'string|null', title: 'string|null', department: 'string|null', location: 'string|null', employmentType: 'string|null', seniority: 'string|null', requiredExperience: 'number|null', mandatorySkills: ['string'], preferredSkills: ['string'], technologies: ['string'], responsibilities: ['string'], domainKnowledge: ['string'], leadershipExpectations: ['string'], certifications: ['string'], hiringCriteria: ['string'], interviewCategories: ['string'] }),
  });
  const prompt = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
  const out = await completeJsonWithFallback(prompt, jobAnalysisSchema);
  if (out.origin === 'ai' && out.result) {
    return { data: out.result.data as JobAnalysis, origin: 'ai', providerId: out.providerId, model: out.model };
  }
  return { data: heuristicJob(jdText), origin: 'fallback', providerId: 'fallback', model: null, error: out.attempts.map((a) => `${a.provider}: ${a.message}`).join('; ') || 'No AI provider available' };
}
