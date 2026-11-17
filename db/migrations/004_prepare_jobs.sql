-- 004_prepare_jobs.sql — one-click "Prepare Interview" background jobs +
-- company dossier cache + provider priority + Natively dir confirmation
-- (2026-11-17). Applied by lib/db.ts migration loader (idempotent).

CREATE TABLE IF NOT EXISTS preparation_jobs (
  id TEXT PRIMARY KEY,
  candidate_id TEXT,
  application_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'partial')),
  current_stage TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  stage_results TEXT,
  error_details TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE,
  duplicate_flags TEXT,
  origin_summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  claimed_at TEXT,
  claimed_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_preparation_jobs_status ON preparation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_preparation_jobs_idempotency ON preparation_jobs(idempotency_key);

CREATE TABLE IF NOT EXISTS company_dossiers (
  company_normalized TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  researched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

ALTER TABLE ai_settings ADD COLUMN provider_priority TEXT;
ALTER TABLE ai_settings ADD COLUMN confirmed_natively_dir TEXT;
ALTER TABLE ai_settings ADD COLUMN confirmed_natively_at TEXT;
