PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Default',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO workspaces (id, name) VALUES (1, 'Default');

CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  location TEXT,
  headline TEXT,
  summary TEXT,
  total_experience_years REAL,
  skills TEXT,
  employment TEXT,
  education TEXT,
  certifications TEXT,
  projects TEXT,
  achievements TEXT,
  notes TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates(email);
CREATE INDEX IF NOT EXISTS idx_candidates_deleted_at ON candidates(deleted_at);
CREATE INDEX IF NOT EXISTS idx_candidates_is_default ON candidates(is_default);

CREATE TABLE IF NOT EXISTS resumes (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mime TEXT,
  size_bytes INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  extracted_text TEXT,
  parsed TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_resumes_candidate_id ON resumes(candidate_id);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  department TEXT,
  location TEXT,
  employment_type TEXT,
  job_url TEXT,
  recruiter TEXT,
  application_date TEXT,
  status TEXT,
  interview_date TEXT,
  stage TEXT,
  jd_text TEXT,
  jd_parsed TEXT,
  company_notes TEXT,
  notes TEXT,
  selected_resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL,
  archived_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_applications_candidate_id ON applications(candidate_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_deleted_at ON applications(deleted_at);

CREATE TABLE IF NOT EXISTS star_stories (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  situation TEXT,
  task TEXT,
  action TEXT,
  result TEXT,
  technologies TEXT,
  skills TEXT,
  employer TEXT,
  project TEXT,
  verification_status TEXT NOT NULL DEFAULT 'draft',
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_star_stories_candidate_id ON star_stories(candidate_id);

CREATE TABLE IF NOT EXISTS interview_sessions (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  title TEXT,
  questions TEXT,
  answers TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_application_id ON interview_sessions(application_id);
CREATE INDEX IF NOT EXISTS idx_sessions_candidate_id ON interview_sessions(candidate_id);

CREATE TABLE IF NOT EXISTS ai_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  openrouter_key TEXT,
  openrouter_model TEXT NOT NULL DEFAULT 'deepseek/deepseek-v4.1-flash',
  ollama_base_url TEXT NOT NULL DEFAULT 'http://localhost:11434',
  ollama_model TEXT NOT NULL DEFAULT 'llama3.1',
  default_provider TEXT NOT NULL DEFAULT 'ollama',
  routing TEXT,
  fallback_model TEXT,
  redact_pii INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO ai_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  provider TEXT,
  model TEXT,
  task TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cost_usd REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at ON ai_usage(created_at);

CREATE TABLE IF NOT EXISTS skills_sync (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  skill_path TEXT,
  status TEXT,
  last_synced TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_skills_sync_application_id ON skills_sync(application_id);

CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY,
  resume_id TEXT REFERENCES resumes(id) ON DELETE CASCADE,
  application_id TEXT REFERENCES applications(id) ON DELETE CASCADE,
  candidate_id TEXT REFERENCES candidates(id) ON DELETE CASCADE,
  chunk_text TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL DEFAULT 'resume'
);
CREATE INDEX IF NOT EXISTS idx_chunks_candidate_id ON document_chunks(candidate_id);
CREATE INDEX IF NOT EXISTS idx_chunks_resume_id ON document_chunks(resume_id);
CREATE INDEX IF NOT EXISTS idx_chunks_application_id ON document_chunks(application_id);
CREATE INDEX IF NOT EXISTS idx_chunks_source_type ON document_chunks(source_type);

CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(chunk_text);
