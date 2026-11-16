-- 003_natively_install.sql — Automatic Natively Skill installation (2026-11-16)
--
-- Records where a Skill was installed into Natively's verified Skills
-- directory (NATIVELY_SKILLS_DIR or the macOS default), how, and when.
-- The manual-export flow (data/skills/, SKILLS_DIR) is untouched.
-- Applied by lib/db.ts migration loader (idempotent ADD COLUMN).

ALTER TABLE skills_sync ADD COLUMN candidate_id TEXT;

ALTER TABLE skills_sync ADD COLUMN install_slug TEXT;

ALTER TABLE skills_sync ADD COLUMN install_method TEXT;

ALTER TABLE skills_sync ADD COLUMN install_path TEXT;

ALTER TABLE skills_sync ADD COLUMN installed_at TEXT;

ALTER TABLE skills_sync ADD COLUMN updated_at TEXT;

ALTER TABLE skills_sync ADD COLUMN install_error TEXT;

CREATE INDEX IF NOT EXISTS idx_skills_sync_install_slug ON skills_sync(install_slug);
