# InterviewHub

Single modular monolith (Next.js 14 App Router + React + TypeScript + Tailwind)
for candidate / resume / application / interview-prep management with local
SQLite (better-sqlite3), FTS5 search, deterministic match/prep heuristics,
optional AI refinement (Ollama local or OpenRouter cloud), and Natively
SKILL.md generation.

One candidate's data never leaks into another candidate's results: every
retrieval query is scoped by `candidate_id`, and AI calls only ever see
retrieved, candidate-scoped evidence — never raw cross-candidate data.

## Quick start

```bash
cp .env.example .env   # fill OPENROUTER_API_KEY / OLLAMA_BASE_URL / SKILLS_DIR as needed
npm install
npm run dev            # http://localhost:3000
npm run build && npm start
```

Health: `GET /api/health`. Data lives in `./data/interviewhub.db`
(gitignored) with uploads in `./data/uploads/` and generated skills in
`./data/skills/` (or `SKILLS_DIR`).

## Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `DATA_DIR` | `./data` | SQLite file, uploads, skills live here |
| `SKILLS_DIR` | `<DATA_DIR>/skills` | Where generated `interview-*.md` skills are written |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Local Ollama endpoint (also settable in AI Settings) |
| `OPENROUTER_API_KEY` | — | Cloud provider key; prefer setting it in the AI Settings UI (stored in the DB, never in `.env` if you can avoid it) |
| `PORT` | `3000` | `next start -p <port>` |

See `.env.example` — it contains no real secrets.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / serve it |
| `npm test` | Vitest unit + API integration tests (84 tests, temp DBs) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Playwright E2E (Chromium, headless) against the built app |
| `npm run lint` | `next lint` |

## Docker Compose

```bash
docker compose up --build
# App on http://127.0.0.1:3000, data persisted in ./data
```

The compose file mounts `./data` into the container and passes
`DATA_DIR=/app/data`, `OLLAMA_BASE_URL` (host Ollama — point it at your
host's Ollama, e.g. `http://host.docker.internal:11434`), `OPENROUTER_API_KEY`
and `SKILLS_DIR` through. See `docker-compose.yml`.

> Note: the Docker build was not verified in this sandbox (no Docker
> available here) — see `PROJECT_CHECKLIST.md`. The Dockerfile is a standard
> three-stage Node 20 build (`deps` → `builder` → `runner`, non-root user).

## Project structure

```
app/                  Next.js App Router pages + API routes
  api/                REST-ish routes (candidates, resumes, applications,
                      star-stories, interview-sessions, ai-settings,
                      backup, search, natively, health)
  candidates/ applications/ star/ prep/ natively/ ai-settings/ settings/
components/           Client UI (Shell, forms, ui primitives, context)
lib/
  db.ts               better-sqlite3 singleton, migrations, JSON helpers
  validation.ts       Zod schemas (incl. aiSettingsSchema routing shapes)
  match.ts            Deterministic match heuristic + grounded AI refinement
  prep.ts             Template prep questions/answers + AI generation
  rag.ts              Chunking + candidate-scoped FTS5 retrieval
  security.ts         Rate limit, safe filenames, path guard, upload allow-list
  parse/              Resume / JD / PDF / DOCX / text parsers
  ai/                 providers (Ollama/OpenRouter), routing, prompts
                      (anti-injection), JSON parsing, usage logging
  natively.ts         SKILL.md builder + skill file writer
  files.ts            Upload storage, skills dir
  serialize.ts        DB row -> API shape (JSON columns parsed)
db/migrations/001_init.sql   Schema (candidates, resumes, applications,
                                 star_stories, interview_sessions,
                                 ai_settings, ai_usage, skills_sync,
                                 document_chunks + FTS5)
tests/
  unit/               match, JD/resume parsers, injection guard, RAG
                      isolation, validation, security, prep templates
  api/                Route-handler integration tests (temp DATA_DIR)
e2e/                  Playwright: full flow against the built app
```

## How matching and prep work

- **Match (deterministic first):** `computeMatch` scores JD requirements
  (skills/keywords, experience, certifications) against the resume text and
  parsed resume. A requirement with no evidence is reported as
  `Not demonstrated` — never invented. Score = 80% requirement coverage +
  20% resume richness, capped at 100.
- **AI refinement (opt-in):** `POST /api/applications/[id]/match` with
  `{ ai_refine: true }` asks the routed provider to reassess. An AI claim of
  "demonstrated" is accepted only if the keyword appears in the retrieved
  candidate-scoped RAG context (or the heuristic already demonstrated it);
  AI "not demonstrated" never overrides heuristic evidence. Malformed AI
  output or provider failure keeps the heuristic result untouched.
- **Prep questions:** template fallback is always available offline; when a
  provider is configured for the `questions` task, AI questions are tried
  first and the template set is used on any failure.
- **STAR drafts:** generated from resume evidence only, returned unsaved
  with `verification_status: 'draft'` — the user reviews and creates the
  story; nothing is ever saved as verified by the AI.

## AI settings and per-task routing

AI Settings (`/ai-settings`) stores one provider + model per task
(`match`, `questions`, `answers`, `skillgen`, `star`, `general`). Routing is
stored canonically as `{ provider, model }`; an empty model means "that
provider's configured default model". Older rows that stored a plain provider
name (`"ollama"` / `"openrouter"`) are accepted by the API, normalised on
read and re-saved in canonical form. The model fields are dropdowns populated
from `GET /api/ai-settings/models?provider=…`; if a provider is unreachable
the field stays a free-text input.

## Backup

`POST /api/backup/export` downloads a JSON snapshot of all tables; the
OpenRouter key is stripped from the export. `POST /api/backup/restore`
merges rows by id (`INSERT OR REPLACE`), restores the non-secret
`ai_settings` fields (models, routing, redact flag — never a key, even if a
hand-crafted backup contains one), and rebuilds full-text search. Details:
`BACKUP.md`.

## Known limitations

- **Local-only, single-user.** No authentication; bind to localhost (or put
  it behind your own auth/reverse proxy) before exposing it. See `SECURITY.md`.
- **Ollama counts as "configured"** whenever a base URL is set, so AI calls
  are attempted and fall back on failure — reachability is only proven by a
  call. If Ollama isn't running, match/prep/STAR endpoints answer with the
  offline fallback and an `ai_error` note.
- **Parsers are heuristic.** The resume/JD parsers use keyword lists and
  regexes; unusual formats (tables, two-column PDFs, scanned images) parse
  poorly. Parsed data is never auto-applied to a profile — **Create from
  resume** and **Add from job link / JD** open pre-filled forms for review
  and edit, and the candidate page has an explicit "Apply parsed data to
  profile" step that only fills blank fields.
- **Auto-import (resume-first / JD-first).** `POST /api/candidates/parse-resume`
  (multipart file) and `POST /api/applications/parse-jd` (`{jd_text}` or
  `{job_url}`, or a JD file) parse without creating anything; the UI then
  opens a pre-filled form. Fields the source does not state stay blank.
  URL fetching for the parse endpoint uses shared
  `lib/parse/fetch-url.ts`, which returns a clear 502 (login wall /
  JavaScript-rendered / blocked — paste the text instead) and never saves
  an empty JD. LinkedIn blocks server fetches, so pasting the job
  description is the fallback there.
- **Permanent candidate/application deletes remove DB rows (with FTS
  cleanup) but uploaded files under `data/uploads/` are only removed for
  resume deletes;** a permanently deleted candidate's upload files can
  remain on disk. See `TROUBLESHOOTING.md`.
- **Live AI calls are not covered by automated tests** (no network/provider
  in CI here): offline fallbacks are tested; OpenRouter/Ollama calls are
  manual-only. See `PROJECT_CHECKLIST.md`.
- **PDF text extraction** uses `pdf-parse`; image-only (scanned) PDFs yield
  no text.

## Install note (this VM)

`better-sqlite3@12.4.1` ships a Node 24 prebuild, so `npm install` normally
needs no native build. If a native build is ever attempted and node-gyp fails
extracting the Node headers with `EPERM: fchown` (sandbox blocks chown),
pre-extract the headers and point node-gyp at them:
`curl -sL https://nodejs.org/dist/v24.22.1/node-v24.22.1-headers.tar.gz | tar --no-same-owner -xz -C /tmp`
then `npm_config_nodedir=/tmp/node-v24.22.1 npm install`.
