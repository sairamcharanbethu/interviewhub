# ARCHITECTURE.md

## Shape

InterviewHub is a single modular monolith: one Next.js 14 app, one SQLite
database, no separate services. The App Router serves both the UI pages and
the JSON API under `app/api/`. Everything runs in one Node process.

```
Browser (React client pages)
  -> Next.js App Router (app/*, components/*)
  -> API routes (app/api/*) — thin: validate, call lib, serialise
  -> lib/* — all business logic, pure where possible
  -> better-sqlite3 (lib/db.ts) — ./data/interviewhub.db (+ WAL)
  -> optional: Ollama (local HTTP) / OpenRouter (cloud HTTPS)
  -> disk: ./data/uploads/* (resumes), <SKILLS_DIR>/interview-*.md
```

## Data model

`db/migrations/001_init.sql` is the single migration, applied idempotently on
every start (`CREATE TABLE IF NOT EXISTS` + `INSERT OR IGNORE` seed rows).
`lib/db.ts` also carries two forward-migration `ALTER TABLE` guards for
columns added after the migration shipped (`ai_settings.redact_pii`,
`document_chunks.source_type`).

| Table | Purpose | Key relations |
| --- | --- | --- |
| `workspaces` | Single row (id 1, "Default"); reserved for multi-workspace later | — |
| `candidates` | Profile: name, contact, skills/employment/education JSON, `is_default`, `archived_at`, `deleted_at` (soft delete) | — |
| `resumes` | One row per upload: file metadata, `extracted_text`, `parsed` JSON, `version`, `is_active` | `candidate_id → candidates ON DELETE CASCADE` |
| `applications` | Company/role/JD (`jd_text`, `jd_parsed` JSON), status/stage, `selected_resume_id`, archive/delete flags | `candidate_id CASCADE`; `selected_resume_id → resumes ON DELETE SET NULL` |
| `star_stories` | STAR stories, `verification_status` (`draft`/`verified`) | `candidate_id CASCADE` |
| `interview_sessions` | Saved question/answer sets per application | `application_id CASCADE`, `candidate_id CASCADE` |
| `ai_settings` | Single row (id 1): provider keys/models, `routing` JSON, `fallback_model`, `redact_pii` | — |
| `ai_usage` | Per-call log: provider, model, task, tokens, cost | — |
| `skills_sync` | Natively SKILL.md sync records per application | `application_id CASCADE` |
| `document_chunks` | RAG chunks (~800 chars, 100 overlap) with `source_type` (`resume`/`jd`/`star`/`note`) | `candidate_id` / `resume_id` / `application_id` all `ON DELETE CASCADE` |
| `document_chunks_fts` | FTS5 index over `chunk_text` (standalone table, NOT content-synced) | Maintained by hand in `lib/rag.ts` |

### FTS5 maintenance — read this before touching deletes

`document_chunks_fts` is a standalone FTS5 table: SQLite does **not** keep it
in sync. Every code path that removes chunks must remove the FTS rows too:

- `lib/rag.ts` `storeDocumentChunks` / `deleteDocumentChunks` — delete FTS
  rows for the replaced/removed chunks first.
- `app/api/resumes/[id]/route.ts` DELETE — deletes FTS rows for the resume's
  chunks before deleting the resume.
- `app/api/candidates/[id]/route.ts` and `app/api/applications/[id]/route.ts`
  permanent deletes — rely on FK cascade for the chunk rows, then call
  `purgeOrphanFts()` (`lib/rag.ts`), which deletes FTS rows whose chunk row
  is gone. Without this, a later chunk insert can reuse a freed `rowid`,
  collide with a stale FTS row (`UNIQUE constraint failed`), and roll back
  the whole upload transaction. This was a real bug, caught by the cascade
  tests — see `tests/api/cascade.test.ts`.
- `app/api/backup/restore/route.ts` — rebuilds the whole FTS table from
  `document_chunks` after restore.

## Request flow

1. **Middleware** (`middleware.ts`): in-memory rate limit (100 req/min/IP)
   on API routes; everything else passes through.
2. **Route handler**: parses/validates the body with a Zod schema
   (`lib/validation.ts`) via `parseJsonBody`; `ApiError` → status-coded
   `{error}` JSON; `ZodError` → 400 with field details (`lib/errors.ts`).
3. **lib functions** do the work against `lib/db.ts` helpers (`all`/`get`/
   `run`/`transaction`). JSON columns are stored as TEXT and parsed on read
   by `lib/serialize.ts`.
4. **Response**: `{ candidate | application | … }` JSON, or `{ error }`.

Uploads (`multipart/form-data`) go through `lib/security.ts`
(`allowedUpload`, 10 MB cap, empty-file rejection) and `lib/files.ts`
(`saveUpload`: sanitised filename, atomic tmp+rename into
`data/uploads/<candidateId>/`).

## AI / RAG design

- **Routing** (`lib/ai/routing.ts`): `routeFor(task)` reads the stored
  routing JSON, normalises it to `{ provider, model }` per task
  (`normalizeRoutingInput` — accepts legacy plain-provider strings and
  legacy task keys like `matching` → `match`), and falls back to
  `DEFAULT_ROUTING` (Ollama `llama3.1`) per task. An empty model means "use
  that provider's configured default model" — `lib/ai/providers.ts` applies
  the default when the route model is falsy.
- **Providers** (`lib/ai/providers.ts`): `chatForTask` routes and calls
  Ollama (`/api/chat`) or OpenRouter (`/chat/completions`), with 60 s
  timeout, max 2 retries on 429/5xx, and per-call usage logging
  (`recordUsage` → `ai_usage`). Keys are never logged.
- **RAG** (`lib/rag.ts`): resumes and JDs are chunked on upload/paste and
  stored with `candidate_id`. `retrieveContext` always filters
  `candidate_id = ?` (and `application_id` when given) — in both the FTS5
  `MATCH` query and the `LIKE` fallback. No candidate scope → no results.
  Queries are sanitised with `stripInjection` before use.
- **Anti-injection** (`lib/ai/prompts.ts`): untrusted content (resume/JD/
  STAR text) is passed through `stripInjection` / `labelAsData` (line
  filters, inline-pattern redaction, base64-blob removal) and wrapped in
  `<DATA>` blocks with system prompts that state the blocks are data, never
  instructions. Every AI call site must do this.
- **Grounded AI** (`lib/match.ts` `refineMatchWithAI`, `lib/prep.ts`): AI
  output is only trusted when it can be traced to retrieved evidence.
  "Demonstrated" claims need the keyword in the retrieved context;
  "not demonstrated" never overrides heuristic evidence; malformed AI JSON
  or provider failure returns the deterministic result with `fallback: true`
  and an `ai_error` note. Nothing AI-generated is ever saved as verified.

## Deterministic core (works with no AI at all)

- `lib/parse/resume.ts` — skill keyword matching, employment/education
  extraction, certification patterns, extraction-quality score.
- `lib/parse/jd.ts` — required/preferred skills, languages, frameworks,
  tools, cloud, responsibilities (section-aware), experience years,
  education, certifications.
- `lib/match.ts` `computeMatch` — requirement coverage + richness, see README.
- `lib/prep.ts` `generateQuestions` / `draftAnswer` — template question bank
  filled with JD keywords and resume evidence.

## Natively skills (file-based export/import — no Natively API)

`lib/natively.ts` builds a standalone `interview-<candidate>-<company>-<role>.md`
(frontmatter `name`/`description` with YAML-escaped values, factual-accuracy
rules, candidate facts kept separate from employer requirements, resume/JD
excerpts, STAR stories) and writes it atomically to `skillsDir()`.

- **Resume resolution:** `lib/context.ts` `resolveResumeForApplication()`
  is the single resolver used by Skill generation, Match, and Prep:
  application `selected_resume_id` wins (validated to belong to the
  candidate, 400 if missing/cross-candidate), active resume is the fallback.
  RAG retrieval takes the same `resumeId`, so chunks never mix versions.
- **Context budget:** excerpts are RAG-selected (JD requirements drive chunk
  choice) within `skill_context_chars` (default 12,000, `POST
  /api/natively/settings`). Truncation is never silent: the file states the
  omitted character count and that the full documents remain in InterviewHub.
- **Lifecycle (`skills_sync`):** `not_generated → generated → file_written →
  awaiting_import → imported → activation_verified`, plus `outdated`
  (resume version or JD hash changed since generation) and `failed`.
  Generation records `file_written` only; `imported` /
  `activation_verified` are set exclusively by the user's manual
  confirmation (`POST /api/natively/confirm`). Previous content is kept in
  `skill_versions` on every regenerate (restore via
  `POST /api/natively/versions`).
- **Collisions:** `resolveSkillName()` adds a stable `-2`/`-3` suffix when
  another application already owns the base name; regenerating the same
  application's Skill requires `confirm_overwrite: true` (409 otherwise).
  Only `interview-*` names may be written (`writeSkillFile` enforces the
  prefix; `guardPath` blocks traversal).

## State and config

- Runtime config lives in the DB (`ai_settings` row) + env (`DATA_DIR`,
  `SKILLS_DIR`, `OLLAMA_BASE_URL`, `OPENROUTER_API_KEY` as fallback).
- `getAiSettings()` prefers the DB row, falls back to env, then defaults.
- The client keeps the selected candidate/application in `components/context.tsx`
  (localStorage-backed) — server state is the DB; the client holds no
  business state of its own.

## Testing architecture

- **Vitest** (`vitest.config.ts`, `@/` alias): unit tests are pure-function
  tests; API tests invoke route handlers directly with real `Request`
  objects against a temp `DATA_DIR` (fresh module registry per file, so no
  DB leaks between files). No live AI: Ollama is unreachable in the sandbox,
  so AI paths exercise their offline fallbacks.
- **Playwright** (`playwright.config.ts`): boots the production build
  (`next start`) with a fresh tmp `DATA_DIR` via `webServer`, one real
  end-to-end flow in `e2e/flow.spec.ts`.
