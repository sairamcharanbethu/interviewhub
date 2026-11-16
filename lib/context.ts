// Shared application-context resolution.
//
// Single source of truth for "which resume does this application use?"
// Match, interview prep, and Natively Skill generation MUST all resolve
// through here so they can never diverge again.
//
// Rules (spec Phase 1.1):
// - An explicitly selected resume (application.selected_resume_id, or an
//   explicit resume_id passed by the caller) wins.
// - The selected resume must belong to the application's candidate and
//   must still exist; otherwise the request fails with 400 — never silently
//   fall back to a different resume, which would mix evidence.
// - Only when no selection exists do we fall back to the candidate's
//   active resume (is_active=1, highest version).

import { get } from './db';
import { ApiError } from './errors';

export type ResumeRow = Record<string, unknown>;

export interface ResolvedResume {
  resume: ResumeRow | null;
  /** 'selected' = explicit application selection; 'active' = fallback. */
  source: 'selected' | 'active' | 'none';
}

/**
 * Resolve the resume for an application row (as returned by the DB).
 * @param explicitResumeId - caller-supplied override (e.g. request body
 *   resume_id). When given it is validated exactly like a stored selection.
 */
export function resolveResumeForApplication(
  app: Record<string, unknown>,
  explicitResumeId?: string | null,
): ResolvedResume {
  const selectedId = explicitResumeId || (app.selected_resume_id as string | null) || null;
  if (selectedId) {
    const resume = get<ResumeRow>(`SELECT * FROM resumes WHERE id = ?`, selectedId);
    if (!resume) {
      throw new ApiError(
        400,
        'The resume selected for this application no longer exists — choose another resume version for the application.',
      );
    }
    if (resume.candidate_id !== app.candidate_id) {
      throw new ApiError(400, 'The selected resume belongs to a different candidate.');
    }
    return { resume, source: 'selected' };
  }
  const active = get<ResumeRow>(
    `SELECT * FROM resumes WHERE candidate_id = ? AND is_active = 1 ORDER BY version DESC LIMIT 1`,
    app.candidate_id,
  );
  return { resume: active ?? null, source: active ? 'active' : 'none' };
}

/** Load an application row (not deleted) or throw 404. */
export function loadApplicationOr404(applicationId: string): Record<string, unknown> {
  const app = get<Record<string, unknown>>(
    `SELECT * FROM applications WHERE id = ? AND deleted_at IS NULL`,
    applicationId,
  );
  if (!app) throw new ApiError(404, 'Application not found');
  return app;
}

/** Load the candidate row for an application, or throw 404. */
export function loadCandidateForApplication(app: Record<string, unknown>): Record<string, unknown> {
  const candidate = get<Record<string, unknown>>(`SELECT * FROM candidates WHERE id = ?`, app.candidate_id);
  if (!candidate) throw new ApiError(404, 'Candidate not found');
  return candidate;
}
