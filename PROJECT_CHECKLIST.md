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
- **PDF/DOCX parsing paths in the API tests** — PDF uploads are now
  route-tested (`tests/unit/pdf-ocr.test.ts`: text PDF stored normally,
  scanned/image-only PDF stored as `needs_review` with a warning, corrupt
  PDF rejected 400 with no resume row and no file). DOCX magic-byte
  validation is unit-tested (`tests/unit/upload-validation.test.ts`) but
  DOCX *extraction* is still not route-tested — worth a manual check with
  a real .docx.
- **Multi-user / concurrent use** — single-user local tool; optional
  password auth (`APP_PASSWORD`, see `SECURITY.md`) is now implemented
  and tested (`tests/api/auth.test.ts`), but there is no concurrency
  testing by design.
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
  A live smoke script exists (`npm run smoke:live-ai`, gated on an
  explicitly configured provider; skips without one).
- Docker build verification — needs a Docker host. (`docker compose
  config` validation was not possible here either — no Docker binary.)
- DOCX upload check against a real file.
- Ollama counts as "configured" by base URL alone, so AI endpoints attempt
  a call and fall back when Ollama is down (by design, but the error copy
  could be clearer — e.g. distinguish "not configured" from "unreachable").
- `npm audit` could not run in this sandbox: the registry policy blocks
  the audit endpoint (`/-/npm/v1/security/audits/quick` → 403
  `policy_denied`, 2026-11-16). Run it on a machine with registry access
  before any shared deployment; Next.js 14.2.18's flagged vulnerability
  is still unevaluated for that reason.
- Playwright browsers live in `~/.cache/ms-playwright` (Chromium 1148,
  ~161 MB); E2E on a fresh machine needs `npx playwright install chromium`
  (network to the Playwright CDN — the first attempt in this sandbox timed
  out and succeeded on retry).

## Remediation sprint 2026-11-16 (this phase)

Production-readiness remediation, 19 defects found by inspection (see
`REMEDIATION_PLAN.md`) plus the sibling auto-import change (resume-first
candidate creation, JD-first application creation — local commit
`2eca6b2`, already on GitHub `main`) and the user's authoritative
file-based Natively spec (implemented as the Skill lifecycle below).
Full account: `REMEDIATION_REPORT.md`.

- [x] **Resume selection** — `lib/context.ts` `resolveResumeForApplication`
  (selected resume wins, must belong to the candidate; 400 on an invalid
  selection; active resume only when nothing is selected). Match, prep,
  and Skill generation all resolve through it.
- [x] **Natively Skill lifecycle** — statuses
  `not_generated/generated/file_written/awaiting_import/imported/
  activation_verified/outdated/failed` (`db/migrations/002_remediation.sql`,
  `skill_versions` table); writing a file never marks it imported;
  preview, regenerate with 409 confirm, version history + restore,
  delete Skill, manual Mark imported / Mark activation verified /
  Mark outdated, outdated detection via `resume_version` + `jd_hash`.
- [x] **Deletion cleanup** — permanent candidate delete removes uploads
  and owned Skill files; application delete removes only its own Skill
  files; errors collected and reported, never silent.
- [x] **Key encryption** — AES-256-GCM (`lib/secrets.ts`,
  `INTERVIEWHUB_SECRET` / generated `data/.secret-key` / macOS Keychain
  when `INTERVIEWHUB_USE_KEYCHAIN=1`); legacy plaintext re-encrypted on
  first read; masked + last4 only; excluded from backups; active store
  shown on the AI Settings page.
- [x] **Auth / network** — localhost-only by default (`next start -H
  127.0.0.1`, Compose `127.0.0.1:3000:3000`); optional `APP_PASSWORD`
  (HMAC sessions, CSRF double-submit, 5 login attempts / 15 min / IP);
  remote requests without a password refused 403; `X-Forwarded-For`
  honoured only with `TRUST_PROXY=1`.
- [x] **Upload validation** — magic bytes (`lib/security.ts`); extraction
  failure deletes the temp file and returns 400 with no half-created row.
- [x] **Rate limiting** — bounded LRU (max 1000 IPs, 5-min TTL sweep,
  100 req/min/IP).
- [x] **PDF/OCR** — scanned/image-only detection (`< 50` meaningful chars
  or `< 20` chars/page) → `needs_review` + warning, never "processed";
  per-page char counts; OCR via tesseract when installed, otherwise a
  clear 422-style message and manual text entry. (No page renderer in
  this codebase, so tesseract cannot be fed page images yet — see
  `REMEDIATION_REPORT.md`.)
- [x] **Long documents** — no silent truncation; `skill_context_chars`
  setting (default 12000), RAG-based excerpt selection, explicit
  "truncated: N chars omitted" warning block in the Skill.
- [x] **AI reliability** — mocked provider tests (invalid key, Ollama
  down, model missing, timeout, 429 + retry, malformed JSON, empty
  response, OpenRouter → Ollama → template fallback, usage recording);
  structured prompts with `<UNTRUSTED DATA>` delimiters + JSON-schema
  validation; injection tests (no secret leak, no behaviour change).
- [x] **Docker** — ARM64-capable `node:20-alpine`, non-root user,
  persistent `./data` volume, HEALTHCHECK on `/api/health`,
  `OLLAMA_BASE_URL=http://host.docker.internal:11434` with `extra_hosts`
  host-gateway, localhost-only port binding. **Build not verified here
  (no Docker in sandbox).**
- [x] **Verification this phase** — `npm test` 180/180 (28 files),
  Playwright E2E 1/1, `npx tsc --noEmit` clean, `npm run build` clean
  (13/13 pages + `/login`), live smoke on the production build (fresh
  DB → candidate → resume → application → JD → Skill `file_written` →
  backup export with no key → `PRAGMA integrity_check` ok,
  `foreign_key_check` empty → restart persistence → permanent delete
  removed 3 files). `npm audit` blocked by sandbox registry policy
  (see above).

## Source-to-documentation reconciliation 2026-11-16 (this pass)

Evidence-based re-check of the remediation claims against the actual
source. Full trace: `SOURCE_CONSISTENCY.md`.

### Claims verified as already fixed (no action taken)

- `middleware.ts` imports `rateLimitIp`; `lib/security.ts:14` exports it
  (plus a `rateLimit` alias at :44). `tsc` passes — no build blocker.
- `resolveResumeForApplication` is used by match, prep questions/answers,
  and Natively generation (via `loadApplicationContext`).
- `lib/cleanup.ts` helpers are invoked by both permanent-delete endpoints
  (candidate `route.ts:51-60`, application `route.ts:47-56`), with FTS
  purge and `file_errors` reporting.
- ai-settings POST encrypts the OpenRouter key before persisting
  (`route.ts:62-86`); legacy plaintext re-encrypts on read
  (`lib/ai/providers.ts:80-93`); stored value asserted `v1:`-prefixed in
  `tests/api/ai-settings-security.test.ts`.
- `validateUploadBytes` is called by resume upload, parse-resume, and JD
  upload; Natively generation records `file_written`, uses the RAG +
  `skill_context_chars` budget, labels omitted chars, escapes YAML.

### Real defects fixed this pass

- **R1 — parse-jd skipped upload validation:** `POST
  /api/applications/parse-jd` never called `validateUploadBytes`. Now
  validated like the other three upload endpoints.
- **R2 — cleanup had no path guard:** `deleteFilesSafely` would delete any
  absolute path; a tampered `stored_path`/`skill_path` DB value could
  escape storage. New `isDeletablePath()` restricts deletes to
  `dataDir()` / configured `skillsDir()`; refusals are reported.
- **R3 — `selected_resume_id` unvalidated on write:** application POST /
  PATCH stored any resume id. New `validateSelectedResume()` (existence +
  candidate ownership, 400) is enforced on both.
- **R4 — `npm run lint` was unconfigured:** `next lint` with no ESLint
  config opened an interactive prompt. Installed `eslint@8.57.1` +
  `eslint-config-next@14.2.18`, added `.eslintrc.json`; lint now runs
  non-interactively with no warnings/errors.
- **R5 — Skill context budget had no UI:** only `POST
  /api/natively/settings` exposed it. Added a budget card on the
  Natively page (GET/POST, 1,000–200,000, default shown).
- **R6 — stale test counts:** README said 84 tests; now 189 tests / 29
  files.

### Verification this pass

- `npx tsc --noEmit` clean; `npm run build` clean; `npm run lint` clean
  (no warnings/errors); `npm test` **189/189 (29 files)**;
  `npm run test:e2e` 1 passed (see final report).
- Docker build NOT RUN (no Docker in sandbox). Live OpenRouter/Ollama
  NOT RUN (no key/Ollama here — provider tests are mocked).

## Automatic Natively Skill installation (2026-11-16)

Filesystem install into Natively's verified local Skills directory —
investigation evidence in `NATIVELY_INSTALL_INVESTIGATION.md` (Natively
source refs: SkillsManager.ts:608, SkillValidator.ts:174-185,
SkillsSettings.tsx:127-129, SkillInstaller.ts). New env
`NATIVELY_SKILLS_DIR` (macOS default `~/Library/Application
Support/Natively/skills/`); never silently falls back to `data/skills/`.
New `lib/natively-install.ts` (stage tmp file in the destination folder,
fsync, atomic rename; realpath containment; symlink-escape refusal;
100 KiB cap; duplicate-slug `-2` suffix; foreign folders moved aside as
backups, never deleted; uninstall only the registered folder and only
when its hash still matches what InterviewHub wrote). New statuses
`installed` / `update_available` / `installation_failed` / `uninstalled`
(migration `003_natively_install.sql`); `installed` means only "file
written to the verified directory", never loaded/activated. New routes
`GET /api/natively/install-config`, `POST /api/natively/install`,
`POST /api/natively/uninstall`; status responses extended with install
info. Manual export unchanged as fallback.

### Verification this pass

- `npx tsc --noEmit` clean; `npm run build` clean; `npm run lint` clean
  (no warnings/errors); `npm test` **218/218 (31 files)** — new
  `tests/unit/natively-install.test.ts` (15) and
  `tests/api/natively-install.test.ts` (14) cover path resolution,
  slug validation, install/update, duplicate slugs, foreign-folder
  confirmation + backup, symlink escape, unconfigured blocking,
  100 KiB limit, uninstall restrictions, and manual-export fallback;
  `npm run test:e2e` 1 passed.
- Docker build NOT RUN (no Docker in sandbox). Live Natively
  verification NOT RUN (no Natively installed here — install flow is
  verified against temp dirs + Natively's source; needs one manual
  confirmation on the user's Mac: install a Skill, bring Natively to
  the front, confirm it appears in the Skills list). Live
  OpenRouter/Ollama NOT RUN (no key/Ollama here — provider tests are
  mocked).

## Prepare Interview refactor (2026-11-17)

- [x] **Provider layer** — `lib/ai/adapters.ts` (OpenRouter, Codex CLI,
  Antigravity CLI, Ollama, template fallback), `lib/ai/cli.ts` (safe
  subprocess runner, timeouts, output caps, per-provider semaphore),
  `lib/ai/registry.ts` (stored priority, first-available selection,
  `completeWithFallback` with failure classification, origin labelling).
  AI Settings UI shows per-provider Installed/Authenticated/Available,
  Test Connection, and priority up/down controls; OpenRouter key prompt
  on first setup (encrypted storage, never logged).
- [x] **AI-first extraction** — `lib/ai/extract.ts` (Zod
  `CandidateProfile`/`JobAnalysis`, grounded evidence, heuristic fallback
  labelled `fallback`, untrusted-data safeguards).
- [x] **Candidate reuse** — `lib/prepare/candidate.ts` (normalized-email
  exact match, new resume version on reuse, duplicate flag without merge,
  blank-fill only).
- [x] **Role insight** — `lib/prepare/prep-package.ts` (AI refinement on
  by default in the job; score clamp deterministic / +10 with evidence
  and recorded justification).
- [x] **Prep package** — intro, 20–30 questions, evidence-grounded
  answers, STAR drafts (verified=false), prioritised study guide; every
  item records origin `ai`/`fallback`.
- [x] **Firecrawl dossier** — `lib/company.ts` (public queries only,
  7-day SQLite cache, graceful skip without a key, Skill research
  instructions on failure).
- [x] **Skill generation** — 15 sections appended to the existing Skill
  builder; 100 KiB cap enforced by dropping lowest-priority sections
  first, omitted sections recorded honestly.
- [x] **Background orchestrator** — migration `004_prepare_jobs.sql`
  (`preparation_jobs`, `company_dossiers`, `provider_priority`,
  `confirmed_natively_dir`); `lib/prepare/job.ts` (atomic claim, stale
  re-claim, idempotency, retry of failed/fallback stages only);
  `lib/prepare/runner.ts` (singleton worker, stages 1–3 critical, 4–9
  partial-tolerant, lazy start guarded out of tests and `next build`).
- [x] **Unified API** — `POST /api/prepare`, `GET /api/prepare/[jobId]`,
  `POST /api/prepare/[jobId]/retry`; existing routes untouched.
- [x] **UI** — `/prepare` (upload + JD tabs + progress + results),
  `/prepare/[jobId]`, dashboard hero, Shell primary nav = Prepare
  Interview + Dashboard with the rest under "Advanced"; AI Settings
  provider panel.
- [x] **Natively confirmation persistence** — confirmed canonical dir in
  `ai_settings`; job installs silently after one confirmation; unconfirmed
  → install stage fails, job `partial`, results screen offers confirm +
  install.
- [x] **Tests** — `tests/unit/cli-providers.test.ts` (mocked CLI runner:
  Codex/Antigravity auth, JSON parsing, timeout fall-through, fallback
  origin), `tests/api/prepare.test.ts` (mocked registry: full flow, email
  reuse + new version, no-email, duplicates flagged, Unknown labels, JD
  URL failure, bad magic bytes, unconfirmed-dir partial + retry without
  duplicates, candidate RAG isolation, malformed-AI fallback),
  `tests/e2e/prepare-workflow.spec.ts` (Playwright, fallback path,
  one-time Natively confirmation dialog, completion screen).
- [ ] **Untested live** — Natively install on the user's Mac, Codex /
  Antigravity auth on the user's Mac, live OpenRouter, live Firecrawl,
  Docker build (no Docker here).
