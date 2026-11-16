# PROJECT_CHECKLIST.md

Final-phase checklist for InterviewHub (tests, docs, reconciliations,
verification). Honest status as of 2026-11-16.

## Reconciliations (done)

- [x] **AI routing shape** — `aiSettingsSchema.routing` accepts both the
  legacy plain-provider string (`"ollama"` / `"openrouter"`) and the
  canonical `{ provider, model }` object; the API normalises to canonical
  form on save and on read (`lib/ai/routing.ts` `normalizeRoutingInput`,
  `normalizeRoute`, legacy task keys `matching` → `match`,
  `star_answers` → `star`, etc.). Per-task routing now round-trips and
  actually drives `routeFor()` (previously a stored string silently fell
  through to the Ollama default). AI Settings UI uses the canonical
  `match`/`questions`/`answers`/`skillgen`/`star`/`general` tasks with
  provider + model per task.
- [x] **POST /api/applications/[id]/restore** — mirrors the candidate
  restore; wired as a **Restore** button for archived applications on
  `/applications` (confirm dialog copy updated).
- [x] **STAR generate-draft wired** — `/star` has a "Generate AI draft"
  button (+ optional role/theme hint) that fills the create form with the
  returned draft; `verification_status` stays `draft`; no-AI / no-evidence
  failures surface as an inline message instead of a silent no-op.
- [x] **AI Settings model picker** — `GET /api/ai-settings/models` drives
  dropdowns for the OpenRouter and Ollama model fields (plus per-task
  model datalists); on provider failure the fields stay free-text with a
  note. "Refresh model lists" reloads them.
- [x] **Backup restore accepts `ai_settings`** — restore now restores the
  non-secret `ai_settings` fields (models, routing, `redact_pii`); a
  smuggled `openrouter_key` in a backup is dropped server-side. Export now
  also includes `redact_pii`. Settings page client-side stripping removed.

## Defects found by the tests and fixed (not suppressed)

- [x] **Stale FTS5 rows after permanent deletes** — FK cascade removed
  chunk rows but not their FTS rows; a later chunk insert could reuse a
  freed `rowid`, hit a UNIQUE violation, and roll back a resume upload
  (500). Added `purgeOrphanFts()` (`lib/rag.ts`), called from the candidate
  and application permanent-delete routes. Regression-covered by
  `tests/api/cascade.test.ts`.
- [x] **Search 500 on hyphenated terms** — `GET /api/search` passed raw user
  input to FTS5 `MATCH`. Now uses `ftsQueryFromText` (quoted tokens).
  Covered by `tests/api/search.test.ts`.
- [x] **JD responsibilities section mis-parsed** — unanchored `/role/`
  matched "About the role" and swallowed the intro as responsibilities;
  section-end detection also missed `Heading: ...` lines. Both fixed in
  `lib/parse/jd.ts`.
- [x] **Resume employment extraction missed `YYYY-MM to YYYY-MM` dates**
  and picked up education lines as employment. Fixed in
  `lib/parse/resume.ts` (month-qualified ranges; degree lines skipped).
- [x] **Empty file uploads created empty resumes** — now rejected with 400
  (resume + JD file paths).
- [x] **Routing schema accepted any provider string** — legacy string
  branch is now `z.enum(['ollama', 'openrouter'])`.

## Tests

### Commands and results (2026-11-16, final run)

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS, no errors |
| `npm run build` | PASS (`✓ Compiled successfully`, 13/13 pages) |
| `npm test` (Vitest) | **84 passed, 0 failed** (17 files) |
| `npm run test:e2e` (Playwright, Chromium headless) | **1 passed, 0 failed** (7.9–9.1 s) |
| Production smoke test (curl, see below) | PASS |

### Vitest breakdown — 84 tests, 17 files

| File | Tests | Covers |
| --- | --- | --- |
| `tests/unit/match.test.ts` | 6 | Score, evidence, "Not demonstrated", no fabricated skills, empty-JD score 50, experience shortfall, stored `jd_parsed` |
| `tests/unit/jd.test.ts` | 6 | Skills/languages/cloud/experience, certs/education, responsibilities, preferred vs required, empty JD, year variants |
| `tests/unit/resume.test.ts` | 5 | Skills/employment/education/certs, contacts, quality score high/low, no invented skills |
| `tests/unit/injection.test.ts` | 6 | `stripInjection` / `containsInjection` / `sanitizeUntrusted` — "ignore previous instructions" neutralised, base64 blobs, empty input |
| `tests/unit/rag.test.ts` | 4 | Cross-candidate isolation (A chunks never for B), no-evidence message, unscoped refusal, per-application JD scoping |
| `tests/unit/validation.test.ts` | 11 | Schema rejections + both routing shapes + routing normalisation |
| `tests/unit/security.test.ts` | 3 | Filename sanitisation, `guardPath`, upload allow-list |
| `tests/unit/prep.test.ts` | 4 | Template questions across categories, empty-JD set, "Not demonstrated" answers |
| `tests/api/candidates.test.ts` | 6 | CRUD, archive/restore, soft-delete/restore, duplicate, set-default, 400/404 |
| `tests/api/resumes.test.ts` | 6 | TXT upload + parse, empty → 400, oversized → 413, bad extension → 400, traversal filename sanitised, 404 |
| `tests/api/applications.test.ts` | 7 | CRUD, JD paste, match, archive/restore, duplicate, delete app → resume remains, 404 |
| `tests/api/prep.test.ts` | 5 | Prep questions offline fallback, STAR draft offline (`draft: null`, status `draft`), manual story defaults to draft |
| `tests/api/search.test.ts` | 2 | Cross-candidate isolation incl. hyphenated term, scope/query required |
| `tests/api/natively.test.ts` | 3 | SKILL.md content on disk (candidate/company/role/stories), 404, missing id → 400 |
| `tests/api/backup.test.ts` | 2 | Export/restore round-trip incl. `ai_settings` (key never restored), unknown table → 400 |
| `tests/api/cascade.test.ts` | 2 | Permanent candidate delete cascades everything; permanent application delete keeps resume (incl. stale-FTS regression) |
| `tests/api/ai-settings.test.ts` | 6 | Legacy → canonical routing round-trip, legacy task-key mapping, bad provider → 400, key never in GET, models endpoint graceful failure + bad provider → 400 |

Tests use temp `DATA_DIR`/`SKILLS_DIR` per file (never `./data`); no test
pollutes the real database.

## Auto-import — resume-first / JD-first (2026-11-16)

- [x] **Resume parsing extended** (`lib/parse/resume.ts`): `ParsedResume`
  now carries `name`, `location`, `headline`, `summary`,
  `total_experience_years` (longest employment range or an explicit
  "X+ years" statement), plus employer/title split for
  `Title — Employer`, `Employer | Title`, comma lists, and title-on-the-
  line-above patterns. Education now splits `degree`/`institution`.
  Nothing is invented: unstatable fields stay `null`.
- [x] **`POST /api/candidates/parse-resume`** — multipart upload, same
  10 MB / pdf/docx/txt/md validation as resume upload; returns
  `{parsed, extracted_text, quality}`, creates nothing. Empty file → 400.
- [x] **Create from resume** (`/candidates`): parses, opens the candidate
  form pre-filled with a "Filled from \<filename\> — check and edit before
  saving" note and per-field "filled from resume" hints; on save the same
  file is attached as the v1 resume.
- [x] **Apply parsed data to profile** (candidate detail → View text):
  replaces the skills-only approval — merges parsed skills AND fills any
  blank profile field (headline/summary/location/contact/employment/
  education/certifications/experience), shows what changed, never
  overwrites a field the user already filled.
- [x] **JD inference** (`lib/parse/jd.ts` `inferCompanyTitle`): company
  (explicit label, "About X", "X is hiring", "Role at X", LinkedIn-style
  "Company · Location", "Company — Remote/Toronto" header), title (label,
  "We are hiring a X", first role-noun heading), location, employment
  type — all nullable, returned on `ParsedJD` without breaking existing
  tests.
- [x] **`POST /api/applications/parse-jd`** — `{jd_text}` / `{job_url}` /
  JD file; returns `{parsed, jd_text, draft}` and creates nothing.
  URL fetching moved to shared `lib/parse/fetch-url.ts` (used by the new
  parse endpoint): 502 names the likely cause (login wall /
  JavaScript-rendered / blocked, incl. LinkedIn) and tells the user to
  paste the JD text; empty JD → 400. The per-application JD route keeps
  its existing fetch for now — migrating it to the shared helper is left
  to the concurrent remediation pass, which is already editing that file.
- [x] **Add from job link / JD** (`/applications`): URL / pasted text /
  file → parsed → application form pre-filled with a "Filled from the job
  posting" note; saving lands on the application detail page with the JD
  saved, so Run Match is one click away. Manual "New application" flow
  untouched (no redirect there).
- [x] **Defects found and fixed (not suppressed):** `inferCompanyTitle`
  "About X" regex could not match multi-word companies (character class
  had no space) and lacked the case-insensitive flag; `splitTitleEmployer`
  mis-assigned the "Employer | Title" order. Both caught by the new tests.
  E2E initially failed after adding the detail-page redirect — the
  redirect was scoped to JD-first creation only, and the remaining failure
  was a stale production build (E2E runs `next start`); rebuilt and it
  passes.

### Auto-import test results (2026-11-16, this change)

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS, no errors |
| `npm run build` | PASS (`✓ Compiled successfully`, incl. `/api/applications/parse-jd` and `/api/candidates/parse-resume`) |
| `npm test` (Vitest) | **103 passed, 0 failed** (18 files) at the time of this change — new: `tests/unit/resume.test.ts` +4 (name/location/headline/summary/experience, dash/pipe split, title-on-previous-line, blank-fields), `tests/unit/jd.test.ts` +5 (Harris inference, explicit labels, hiring sentence, LinkedIn-style line, blank-fields), `tests/api/auto-import.test.ts` 10 (both parse endpoints, no-creation checks, empty/bad-extension/non-multipart, empty JD, invalid URL → 400, unreachable URL → 502 with paste fallback, JD file upload) |
| `npm run test:e2e` (Playwright) | **1 passed** after rebuild (see note above) |

Note: a later full-suite run in this same checkout showed 3–4 failures
in `tests/api/auth.test.ts`, `tests/api/natively.test.ts`,
`tests/unit/pdf-ocr.test.ts` and `tests/api/cascade.test.ts` (skills_sync
count) — those belong to a separate, concurrently in-progress remediation
(auth / Natively / upload-validation) whose uncommitted changes were in
the working tree at the time; they are NOT part of this auto-import
change, and none of its files were included in this push. The auto-import
tests themselves pass in isolation and in the 103-test run above.

### Playwright E2E — 1 spec, passing

`e2e/flow.spec.ts` (Chromium 131, headless, against `next start` on a tmp
`DATA_DIR`): create candidate → upload txt resume → create application →
paste JD → run match → generate questions offline → export skill → verify
file content on disk → delete application, resume remains → archive/restore
candidate → permanent-delete cleanup via API.

### Production smoke test (curl, 2026-11-16)

Production server (`npm run build && DATA_DIR=/tmp/ih-smoke-data npm run
start -p 3100`), realistic Oracle DBA resume for Naga Iswarya Lakshmi
Bhogadi + Harris Computer JD:

- `GET /api/health` → `{"status":"ok","db":"ok","ollama_reachable":false,"openrouter_configured":false}`
- Create candidate → `cand_mwim9902-u1riznx8`
- Upload txt resume → v1, active, extraction quality **100**, skills
  `Oracle, Oracle RAC, Oracle Data Guard, Oracle ASM, PL/SQL…`
- Create application (Harris Computer — Technical Consultant – Oracle DBA)
  → `app_mwim995k-yvy3x6zy`
- Paste JD → 17 required skills, experience 3
- `POST match` → **score 96**, 17/17 skills matched, only
  `Certification: Oracle Certified Professional (OCP)` "Not demonstrated"
- `POST prep/questions` → `template-offline-fallback`, 25 questions,
  `ai_error: "AI provider failed: fetch failed"` (no Ollama running)
- `POST /api/natively/generate` → `status: synced`,
  `interview-naga-iswarya-lakshmi-bhogadi-harris-computer-technical-consultant-oracle-dba.md`
  on disk, containing candidate/company/role and "DXC Technology"
- Archive + restore application via curl → `archived_at` set, then `null`
- Legacy routing POST (`{match: "openrouter"}`) → GET returns canonical
  `{match: {provider: "openrouter", model: ""}}`
- Backup export → no `openrouter_key` anywhere; tampered restore (smuggled
  key) → key dropped, `has_openrouter_key: false`, counts include
  `ai_settings: 1`

Smoke-test data was in `/tmp/ih-smoke-data` (deleted afterwards). `./data`
verified empty afterwards (0 records in every table, empty `uploads/`).

## What was NOT tested

- **Live OpenRouter / Ollama calls** — no provider reachable in this
  sandbox (no key, no local Ollama). Only the offline fallbacks and the
  "provider failed" paths are covered. Manual check needed: set a key or
  run Ollama, then `POST match` with `{ai_refine: true}` and confirm
  `ai_refined: true` with grounded evidence.
- **Docker build** — no Docker in this sandbox (`which docker` → nothing).
  `docker compose up --build` is untested here; the Dockerfile is a
  standard 3-stage Node 20 build. Verify on a machine with Docker before
  relying on it.
- **PDF/DOCX parsing paths in the API tests** — only `.txt` uploads are
  exercised end-to-end (the parsers for PDF/DOCX are library code, not
  route-tested). A real PDF upload check is worth doing manually.
- **Multi-user / concurrent use** — single-user local tool; no concurrency
  or auth testing exists by design.
- **Browser matrix** — Playwright ran Chromium only. Firefox/WebKit not
  installed or attempted.

## Docs

- [x] `README.md` — full rewrite (install, scripts, env vars, Docker
  Compose, structure, match/prep semantics, routing, backup, limitations)
- [x] `ARCHITECTURE.md` — shape, data model, FTS5 maintenance rules,
  request flow, AI/RAG design, testing architecture
- [x] `USER_GUIDE.md` — the full flow, AI settings, search, backup
- [x] `SECURITY.md` — threat model, controls, what is NOT protected
- [x] `TROUBLESHOOTING.md` — start/DB, uploads/parsing, match/prep,
  AI settings, skills, backup, orphans, tests
- [x] `BACKUP.md` — format, export/restore semantics, what restore does not do
- [x] `PROJECT_CHECKLIST.md` — this file

## Hygiene verified

- [x] `.env.example` contains no real secrets (placeholders only).
- [x] `.gitignore` covers `data/`, `node_modules`, `.next`, `.env`,
  `.env.local`, `.env*.local`, plus `test-results/` and
  `playwright-report/` (added this phase).
- [x] `./data` left empty of test records (0 rows, empty `uploads/`).
- [x] Scratch dirs removed (`/tmp/ih-smoke-data`, `/tmp/ih-e2e-*`,
  `/tmp/ih-test-*`, smoke-test resume/JD/backup files).

## Remaining work / known limitations

- Live-provider verification (OpenRouter/Ollama) — manual, see above.
- Docker build verification — needs a Docker host.
- PDF/DOCX upload check against real files.
- Permanent candidate delete leaves the candidate's uploaded files on disk
  (`data/uploads/<candidateId>/`) — manual cleanup; only resume deletes
  remove the stored file. Documented in `TROUBLESHOOTING.md`.
- Ollama counts as "configured" by base URL alone, so AI endpoints attempt
  a call and fall back when Ollama is down (by design, but the error copy
  could be clearer — e.g. distinguish "not configured" from "unreachable").
- `npm audit` not run as part of this phase; run before any shared deployment.
- Playwright browsers live in `~/.cache/ms-playwright` (Chromium 1148,
  ~161 MB); E2E on a fresh machine needs `npx playwright install chromium`
  (network to the Playwright CDN — the first attempt in this sandbox timed
  out and succeeded on retry).
