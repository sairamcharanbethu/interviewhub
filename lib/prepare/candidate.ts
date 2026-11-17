// Candidate matching / reuse for the one-click Prepare flow.
// Normalized email (lowercase, trim) exact match → reuse that candidate and
// upload the resume as a new version. No match → create. Multiple/ambiguous
// matches → flag duplicate_candidate_ids on the job, do NOT merge, do NOT
// stop the job (proceed with a new candidate). Never overwrite verified
// candidate details with conflicting extracted values — only fill blanks.
import { all, get, run, newId, now } from '../db';
import type { CandidateProfile } from '../ai/extract';

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const v = email.trim().toLowerCase();
  return v || null;
}

export function findCandidatesByEmail(email: string): Array<Record<string, unknown>> {
  const norm = normalizeEmail(email);
  if (!norm) return [];
  return all<Record<string, unknown>>(
    `SELECT * FROM candidates WHERE lower(trim(email)) = ? AND deleted_at IS NULL ORDER BY created_at ASC`,
    norm,
  );
}

export interface ReuseOutcome {
  candidateId: string;
  reused: boolean;
  duplicateCandidateIds: string[];
  candidate: Record<string, unknown>;
}

/** Fill blank candidate fields from an extracted profile; never overwrite a non-blank value. */
export function fillBlankCandidateFields(candidateId: string, profile: CandidateProfile): void {
  const row = get<Record<string, unknown>>(`SELECT * FROM candidates WHERE id = ?`, candidateId);
  if (!row) return;
  const updates: Record<string, unknown> = {};
  const set = (col: string, v: unknown) => {
    const cur = row[col];
    if ((cur === null || cur === undefined || cur === '') && v !== null && v !== undefined && v !== '') updates[col] = v;
  };
  set('phone', profile.phone);
  set('location', profile.location);
  set('headline', profile.headline);
  set('summary', profile.summary);
  if ((row.total_experience_years === null || row.total_experience_years === undefined) && profile.totalYearsExperience !== null) updates.total_experience_years = profile.totalYearsExperience;
  const existingSkills = (() => { try { return JSON.parse((row.skills as string) || '[]') as string[]; } catch { return []; } })();
  if (!existingSkills.length && profile.skills.technical.length) updates.skills = JSON.stringify(profile.skills.technical);
  const existingCerts = (() => { try { return JSON.parse((row.certifications as string) || '[]') as string[]; } catch { return []; } })();
  if (!existingCerts.length && profile.certifications.length) updates.certifications = JSON.stringify(profile.certifications);
  const existingEmp = (() => { try { return JSON.parse((row.employment as string) || '[]') as unknown[]; } catch { return []; } })();
  if (!existingEmp.length && profile.employment.length) {
    updates.employment = JSON.stringify(profile.employment.map((e) => ({ employer: e.employer, title: e.position, dates: [e.startDate, e.endDate].filter(Boolean).join(' — ') || undefined, raw: [e.position, e.employer].filter(Boolean).join(' — ') })));
  }
  const existingEdu = (() => { try { return JSON.parse((row.education as string) || '[]') as unknown[]; } catch { return []; } })();
  if (!existingEdu.length && profile.education.length) {
    updates.education = JSON.stringify(profile.education.map((e) => ({ institution: e.institution, degree: e.credential, raw: [e.credential, e.institution].filter(Boolean).join(', ') })));
  }
  if (!Object.keys(updates).length) return;
  const sets = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  run(`UPDATE candidates SET ${sets}, updated_at = ? WHERE id = ?`, ...Object.values(updates), now(), candidateId);
}

export function createCandidateFromProfile(profile: CandidateProfile): Record<string, unknown> {
  const id = newId('cand_');
  const ts = now();
  const name = profile.fullName || 'Unknown Candidate';
  run(
    `INSERT INTO candidates (id, name, email, phone, location, headline, summary, total_experience_years, skills, employment, education, certifications, projects, achievements, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, name, normalizeEmail(profile.email), profile.phone ?? null, profile.location ?? null,
    profile.headline ?? null, profile.summary ?? null, profile.totalYearsExperience ?? null,
    JSON.stringify(profile.skills.technical), JSON.stringify(profile.employment.map((e) => ({ employer: e.employer, title: e.position, raw: [e.position, e.employer].filter(Boolean).join(' — ') }))),
    JSON.stringify(profile.education.map((e) => ({ institution: e.institution, degree: e.credential, raw: [e.credential, e.institution].filter(Boolean).join(', ') }))),
    JSON.stringify(profile.certifications), JSON.stringify(profile.projects), JSON.stringify(profile.measurableAchievements), null, ts, ts,
  );
  return get<Record<string, unknown>>(`SELECT * FROM candidates WHERE id = ?`, id)!;
}

export function reuseOrCreateCandidate(profile: CandidateProfile): ReuseOutcome {
  const email = normalizeEmail(profile.email);
  if (email) {
    const matches = findCandidatesByEmail(email);
    if (matches.length === 1) {
      const candidate = matches[0];
      fillBlankCandidateFields(String(candidate.id), profile);
      const refreshed = get<Record<string, unknown>>(`SELECT * FROM candidates WHERE id = ?`, String(candidate.id))!;
      return { candidateId: String(candidate.id), reused: true, duplicateCandidateIds: [], candidate: refreshed };
    }
    if (matches.length > 1) {
      // Ambiguous: flag, do not merge, proceed with a fresh candidate.
      const created = createCandidateFromProfile(profile);
      return { candidateId: String(created.id), reused: false, duplicateCandidateIds: matches.map((m) => String(m.id)), candidate: created };
    }
  }
  const created = createCandidateFromProfile(profile);
  return { candidateId: String(created.id), reused: false, duplicateCandidateIds: [], candidate: created };
}
