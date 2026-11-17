import { z } from 'zod';

export const candidateSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  headline: z.string().max(500).optional().nullable(),
  summary: z.string().optional().nullable(),
  total_experience_years: z.number().min(0).max(80).optional().nullable(),
  skills: z.array(z.string()).optional().nullable(),
  employment: z.array(z.record(z.unknown())).optional().nullable(),
  education: z.array(z.record(z.unknown())).optional().nullable(),
  certifications: z.array(z.string()).optional().nullable(),
  projects: z.array(z.record(z.unknown())).optional().nullable(),
  achievements: z.array(z.string()).optional().nullable(),
  notes: z.string().optional().nullable(),
});
export const candidatePatchSchema = candidateSchema.partial();

export const applicationSchema = z.object({
  candidate_id: z.string().min(1),
  company: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  department: z.string().max(200).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  employment_type: z.string().max(100).optional().nullable(),
  job_url: z.string().url().optional().nullable().or(z.literal('')),
  recruiter: z.record(z.unknown()).optional().nullable(),
  application_date: z.string().optional().nullable(),
  status: z.string().max(100).optional().nullable(),
  interview_date: z.string().optional().nullable(),
  stage: z.string().max(100).optional().nullable(),
  jd_text: z.string().optional().nullable(),
  jd_parsed: z.record(z.unknown()).optional().nullable(),
  company_notes: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  selected_resume_id: z.string().optional().nullable(),
});
export const applicationPatchSchema = applicationSchema.partial().omit({ candidate_id: true });

export const starStorySchema = z.object({
  candidate_id: z.string().min(1),
  title: z.string().min(1).max(300),
  situation: z.string().optional().nullable(),
  task: z.string().optional().nullable(),
  action: z.string().optional().nullable(),
  result: z.string().optional().nullable(),
  technologies: z.array(z.string()).optional().nullable(),
  skills: z.array(z.string()).optional().nullable(),
  employer: z.string().max(200).optional().nullable(),
  project: z.string().max(200).optional().nullable(),
  verification_status: z.string().max(50).optional().nullable(),
});
export const starStoryPatchSchema = starStorySchema.partial().omit({ candidate_id: true });

export const sessionSchema = z.object({
  application_id: z.string().min(1),
  candidate_id: z.string().min(1),
  title: z.string().max(300).optional().nullable(),
  questions: z.array(z.record(z.unknown())).optional().nullable(),
  answers: z.array(z.record(z.unknown())).optional().nullable(),
  notes: z.string().optional().nullable(),
});
export const sessionPatchSchema = sessionSchema.partial().omit({ application_id: true, candidate_id: true });

/**
 * Per-task routing. Accepts BOTH shapes and stores the canonical one:
 * - legacy plain provider string: "ollama" | "openrouter" (model = provider default)
 * - canonical object: { provider, model? }
 * Normalisation happens in lib/ai/routing.ts (normalizeRoutingInput); the
 * ai-settings route normalises before storing, and getRouting() normalises
 * on read, so old string-form rows round-trip without breaking routing.
 */
const routeValueSchema = z.union([
  z.enum(['ollama', 'openrouter']),
  z.object({ provider: z.enum(['ollama', 'openrouter']), model: z.string().max(200).optional().nullable() }),
]);

export const aiSettingsSchema = z.object({
  openrouter_key: z.string().optional().nullable(),
  openrouter_model: z.string().max(200).optional().nullable(),
  ollama_base_url: z.string().url().optional().nullable(),
  ollama_model: z.string().max(200).optional().nullable(),
  default_provider: z.enum(['ollama', 'openrouter']).optional().nullable(),
  routing: z.record(routeValueSchema).optional().nullable(),
  fallback_model: z.string().max(200).optional().nullable(),
  redact_pii: z.boolean().optional().nullable(),
  provider_priority: z.array(z.enum(['openrouter', 'codex', 'antigravity', 'ollama', 'fallback'])).optional().nullable(),
});

export const backupRestoreSchema = z.object({
  version: z.number().optional(),
  exported_at: z.string().optional(),
  tables: z.record(z.array(z.record(z.unknown()))),
});

export const jdTextSchema = z.object({ jd_text: z.string().min(1) });
export const nativelyGenerateSchema = z.object({ application_id: z.string().min(1) });

export type CandidateInput = z.infer<typeof candidateSchema>;
