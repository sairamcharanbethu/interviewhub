-- 002_remediation.sql — production-readiness remediation sprint (2026-11-16)
--
-- Applied by lib/db.ts migration loader (idempotent: ADD COLUMN statements
-- are skipped when the column already exists; CREATE TABLE uses IF NOT EXISTS).
-- Safe to re-run on a database that already has these objects.

-- Natively lifecycle: record which resume version + JD content a Skill was
-- generated from, so outdated Skills can be detected (resume or JD changed).
ALTER TABLE skills_sync ADD COLUMN resume_version INTEGER;
ALTER TABLE skills_sync ADD COLUMN jd_hash TEXT;
ALTER TABLE skills_sync ADD COLUMN content_hash TEXT;
ALTER TABLE skills_sync ADD COLUMN version_number INTEGER NOT NULL DEFAULT 1;

-- Skill version history: previous valid content is preserved on every
-- regeneration so a bad regenerate can be restored.
CREATE TABLE IF NOT EXISTS skill_versions (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  skill_path TEXT,
  version_number INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_skill_versions_application_id ON skill_versions(application_id);

-- Configurable Skill context budget (chars). 0 / NULL = default 12000.
-- ai_settings keeps the OpenRouter key column; encryption is applied at the
-- application layer (lib/secrets.ts, v1: prefix) — no schema change needed.
ALTER TABLE ai_settings ADD COLUMN skill_context_chars INTEGER;
