// Shared client-side types mirroring the API serialisers in lib/serialize.ts
// and the route response shapes. Field names come from the routes, not guesses.
export interface Candidate {
  id: string; name: string; email?: string | null; phone?: string | null;
  location?: string | null; headline?: string | null; summary?: string | null;
  total_experience_years?: number | null;
  skills: string[]; employment: Record<string, unknown>[]; education: Record<string, unknown>[];
  certifications: string[]; projects: Record<string, unknown>[]; achievements: string[];
  notes?: string | null; is_default: boolean;
  archived_at?: string | null; deleted_at?: string | null;
  created_at: string; updated_at: string;
}
export interface Resume {
  id: string; candidate_id: string; filename: string; stored_path: string;
  mime?: string | null; size_bytes?: number | null; version: number;
  extracted_text?: string | null;
  parsed?: { name?: string | null; location?: string | null; headline?: string | null; summary?: string | null; total_experience_years?: number | null; skills?: string[]; employment?: unknown[]; education?: unknown[]; certifications?: string[]; emails?: string[]; phones?: string[]; extraction_quality?: number } | null;
  is_active: boolean; created_at: string;
}
export interface Application {
  id: string; candidate_id: string; company: string; title: string;
  department?: string | null; location?: string | null; employment_type?: string | null;
  job_url?: string | null; recruiter?: unknown; application_date?: string | null;
  status?: string | null; interview_date?: string | null; stage?: string | null;
  jd_text?: string | null; jd_parsed?: {
    company?: string | null; title?: string | null; location?: string | null; employment_type?: string | null;
    required_skills?: string[]; preferred_skills?: string[]; languages?: string[];
    frameworks?: string[]; tools?: string[]; cloud?: string[]; responsibilities?: string[];
    experience_years?: number | null; education?: string[]; certifications?: string[]; keywords?: string[];
  } | null;
  company_notes?: string | null; notes?: string | null;
  selected_resume_id?: string | null; archived_at?: string | null; deleted_at?: string | null;
  created_at: string; updated_at: string;
}
export interface StarStory {
  id: string; candidate_id: string; title: string;
  situation?: string | null; task?: string | null; action?: string | null; result?: string | null;
  technologies: string[]; skills: string[]; employer?: string | null; project?: string | null;
  verification_status: string; archived_at?: string | null;
  created_at: string; updated_at: string;
}
export interface InterviewSession {
  id: string; application_id: string; candidate_id: string; title?: string | null;
  questions: Record<string, unknown>[]; answers: Record<string, unknown>[];
  notes?: string | null; created_at: string; updated_at: string;
}
export interface PrepQuestion { category: string; question: string; source?: string }
export interface PrepAnswer { question: string; category: string; answer: string; evidence: string[]; gaps: string[]; source?: string }
export interface MatchRequirement { requirement: string; demonstrated: boolean; evidence: string }
export interface MatchResult {
  application_id: string; resume_id: string; score: number;
  requirements: MatchRequirement[];
  summary: { skills_matched: number; skills_total: number; experience_years: number | null; experience_required: number | null; certifications_matched: string[]; certifications_required: string[] };
  method: string; ai_refined: boolean;
}
export interface AiRoute { provider: string; model?: string | null }
export interface AiSettings {
  id: number; openrouter_model: string; ollama_base_url: string; ollama_model: string;
  default_provider: string; routing: Record<string, AiRoute | string> | null; fallback_model?: string | null;
  has_openrouter_key: boolean; openrouter_key_last4?: string | null;
  secret_storage?: 'env' | 'keychain' | 'file' | 'none' | null; secret_storage_has_key?: boolean;
  provider_priority?: string[];
  providers?: Array<{ id: string; name: string; installed: boolean; authenticated: boolean; authStatus: string; available: boolean; detail?: string }>;
}
export interface AiUsageRow { id: string; provider?: string | null; model?: string | null; task?: string | null; tokens_in?: number | null; tokens_out?: number | null; cost_usd?: number | null; created_at: string }
export interface SkillSync { id: string; application_id: string; skill_name: string; skill_path?: string | null; status?: string | null; last_synced?: string | null; error?: string | null; resume_version?: number | null; jd_hash?: string | null; content_hash?: string | null; version_number?: number | null; candidate_id?: string | null; install_slug?: string | null; install_method?: string | null; install_path?: string | null; installed_at?: string | null; updated_at?: string | null; install_error?: string | null }
export interface HealthData { status: string; db: string; ollama_reachable: boolean; openrouter_configured: boolean; timestamp: string }

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
export function fmtDate(s?: string | null): string {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
export function fmtDateTime(s?: string | null): string {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? s : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export function splitList(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}
export function parseJsonLines(v: string): unknown[] {
  const t = v.trim();
  if (!t) return [];
  try {
    const parsed = JSON.parse(t);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => ({ raw: l }));
  }
}
export function stringifyJson(v: unknown): string {
  return JSON.stringify(v ?? [], null, 2);
}
