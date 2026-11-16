# InterviewHub — Remediation Report (2026-11-16)

Production-readiness remediation sprint for InterviewHub (Next.js 14.2.18 +
TypeScript + better-sqlite3 + FTS5). The app's architecture was preserved —
no rewrite, no framework change. This report covers the defects found by
inspection, what was fixed, the tests run with actual results, and what
remains untested. It also folds in the user's authoritative file-based
Natively spec (single standalone `interview-{candidate}-{company}-{role}.md`
per application, manual import, version history) and the sibling auto-import
change (resume-first candidate creation, JD-first application creation —
local commit `2eca6b2`, already on GitHub `main`).

## Defects discovered and fixed

### Phase 1 — Critical functional defects

1. **Skill generation ignored `applications.selected_resume_id`.**
   `lib/natively.ts` `loadApplicationContext()` always used the candidate's
   active resume. Fixed with a single shared resolver,
   `lib/context.ts` `resolveResumeForApplication()`: the selected resume
   wins; it must belong to the application candidate (400 otherwise);
   the active resume is used only when no selection exists. Match, prep,
   and Skill generation all resolve through it, so they cannot diverge.
2. **Writing a Skill file marked it `synced`.** The old `skills_sync.status`
   claimed the file was synced/imported in Natively the moment it was
   written. Fixed: writing sets `file_written` only. New statuses
   (`db/migrations/002_remediation.sql`):
   `not_generated / generated / file_written / awaiting_import / imported /
   activation_verified / outdated / failed`. Import and activation are
   tracked only by explicit user confirmation ("Mark imported" /
   "Mark activation verified" buttons, `app/api/natively/confirm`).
3. **No Skill version history; silent overwrite on slug collision.**
   Added `skill_versions` (FK cascade) — every regenerate preserves the
   previous content as a new version; the UI lists versions with Restore.
   A slug collision from a *different* application gets a stable `-2`/`-3`
   suffix (`resolveSkillName`) instead of overwriting; regenerating the
   same application's file requires an explicit `confirm_overwrite`
   (409 `needs_confirmation` otherwise).
4. **Silent truncation** (resume 6000 chars, JD 4000 chars) in
   `buildSkillMd`. Removed. New `ai_settings.skill_context_chars`
   (default 12000, editable in Settings), RAG-based relevant-section
   selection per application (resume chunks + JD chunks most relevant to
   the JD requirements, selected-resume only), and an explicit
   "truncated: N chars omitted, full text in stored resume/JD" warning
   block in the Skill whenever excerpts are used, with source references
   (resume vN, JD hash). Completeness is never claimed when excerpted.
5. **Permanent candidate delete left orphan files** (uploads + Skills).
   Fixed: `lib/cleanup.ts` snapshots the file paths *before* the DB
   delete (FK cascade would remove the source rows), deletes resume files
   under `data/uploads/<candidateId>/` and Skill files owned by the
   candidate, and returns `{ files_removed, file_errors }`.
6. **Application delete left its Skill files.** Fixed the same way —
   application permanent delete removes only that application's Skill
   files and reports `{ skill_files_removed, file_errors }`; other
   applications' Skills and candidate resumes are preserved.
7. **Outdated detection.** `skills_sync` now stores `resume_version`,
   `jd_hash`, `content_hash`, `version_number` at generation; the status
   endpoint recomputes on load and flags `outdated` when the resume
   version or JD hash changed. A "Mark outdated" button exists too.

### Phase 2 — Security

8. **OpenRouter key plaintext in SQLite** (`ai_settings.openrouter_key`).
   AES-256-GCM (`lib/secrets.ts`): key from `INTERVIEWHUB_SECRET`, or a
   generated `data/.secret-key` file (0600, gitignored, created on first
   run). On macOS, `INTERVIEWHUB_USE_KEYCHAIN=1` stores the key in the
   macOS Keychain via the `security` CLI (server-side only); the Keychain
   is tried first, falling back to the encrypted store. Legacy plaintext
   keys are transparently re-encrypted on first read and the plaintext
   column value wiped. The API returns masked + last4 only, never the
   full key, never logs it, never includes it in backup exports. Replace
   and delete are supported (AI Settings "Clear the saved key"). The
   active store is shown on the AI Settings page.
9. **No auth; `next start` bound 0.0.0.0 by default.** Now
   `next start -H 127.0.0.1` (package.json `start` script) and
   `127.0.0.1:3000:3000` in Docker Compose. Optional `APP_PASSWORD`:
   login page (`/login`), HMAC session cookie (httpOnly, `SameSite=Lax`,
   `Secure` when remote, 7-day expiry), CSRF double-submit token on
   mutating API calls, login rate limit (5 attempts / 15 min / IP,
   bounded store). If `APP_PASSWORD` is unset and the request is not
   from localhost/loopback, the middleware refuses with
   403 "Remote access requires APP_PASSWORD".
10. **Rate limiter unbounded Map + trusted `X-Forwarded-For` blindly.**
    Replaced with a bounded LRU (`lib/security.ts`, max 1000 IPs, 5-min
    TTL sweep, 100 req/min/IP default). `X-Forwarded-For` is honoured
    only when `TRUST_PROXY=1`; otherwise the socket remote address is
    used.
11. **Upload validation trusted browser MIME.** Magic-byte validation
    (`lib/security.ts` `validateUploadBytes`): PDF must start `%PDF`,
    DOCX must be a valid ZIP (`PK\x03\x04`) containing
    `[Content_Types].xml`, TXT/MD must decode as UTF-8; extension+MIME
    consistency; browser MIME never trusted alone. 10 MB + empty-file
    rejection kept. On extraction failure the stored temp file is deleted
    and the endpoint returns 400 with no half-created resume row. Applied
    to resume uploads and JD file uploads.

### Phase 3 — Documents

12. **Scanned/image-only PDFs silently "processed".** Detection in
    `lib/parse/pdf.ts` `analysePdf` (extracted text < 50 meaningful chars
    or < 20 chars/page): the resume route marks
    `extraction_quality` low and `needs_review`, with a warning — never
    "processed". Page-level char counts are stored in parsed metadata.
13. **No OCR fallback.** `tesseract` CLI is used when installed
    (`ocrAvailable()` checks `which tesseract` at runtime); when absent
    the API returns a clear message — "OCR unavailable — install
    tesseract (`brew install tesseract`) or paste the text" — and the
    resume stays in needs-review with manual text entry allowed.
    Limitation: this codebase has no PDF page renderer, so tesseract
    cannot currently be fed page images (`tryOcrPdf` returns null even
    when tesseract exists). The Docker image installs `tesseract-ocr`
    so the binary is present; wiring page rendering is future work.

### Phase 4 — AI reliability

14. **Provider behaviour untested.** Mocked-fetch provider tests
    (`tests/unit/providers.test.ts`): valid/invalid OpenRouter key,
    Ollama unavailable, model missing, timeout (AbortController),
    429 + retry, malformed JSON, empty response, provider fallback
    (OpenRouter fails → Ollama → template fallback), cost + token
    tracking recorded in `ai_usage`.
15. **AI prompt protection was regex-only.** Added
    `lib/ai/structured.ts`: structured prompts with explicit
    `<UNTRUSTED DATA>` delimiters marking resume/JD as data (not
    instructions) and JSON-schema validation of AI output with fallback
    to the heuristic result on failure. `stripInjection` remains as
    defence-in-depth. All AI calls build context through the shared
    resolver (candidate + application + selected resume enforced).
16. **Live-provider smoke script.** `scripts/smoke-live-ai.mjs`
    (`npm run smoke:live-ai`): runs live checks only when OpenRouter or
    Ollama is explicitly configured; otherwise it skips (exit 0) and says
    so. Mocked tests are never presented as live integration.

### Phase 5 — Docker / deployment

17. **Compose defaulted `OLLAMA_BASE_URL=http://localhost:11434`**
    (wrong inside a container). Now
    `http://host.docker.internal:11434` with `extra_hosts:
    host-gateway` so a host Ollama is reachable on Linux too.
18. **Dockerfile gaps.** Added HEALTHCHECK on `/api/health`, `tesseract-ocr`
    + `wget`, non-root `app` user, ARM64-capable `node:20-alpine`
    (linux/arm64 + amd64 buildable). Persistent `./data` volume for
    sqlite + uploads + skills. Localhost-only host binding
    (`127.0.0.1:3000:3000`).
19. **`npm audit` blocked in this sandbox.** The registry policy rejects
    the audit endpoint (`/-/npm/v1/security/audits/quick` → 403
    `policy_denied`, 2026-11-16). The Next.js 14.2.18 flagged
    vulnerability is therefore **unevaluated** — no upgrade was attempted
    blind. Run `npm audit` on a machine with registry access before any
    shared deployment.

## Files changed (vs. auto-import commit `2eca6b2`)

Modified (37): `.env.example`, `.gitignore`, `ARCHITECTURE.md`,
`Dockerfile`, `PROJECT_CHECKLIST.md`, `README.md`, `SECURITY.md`,
`TROUBLESHOOTING.md`, `USER_GUIDE.md`, `app/ai-settings/page.tsx`,
`app/api/ai-settings/route.ts`,
`app/api/applications/[id]/jd/route.ts`,
`app/api/applications/[id]/match/route.ts`,
`app/api/applications/[id]/prep/answers/route.ts`,
`app/api/applications/[id]/prep/questions/route.ts`,
`app/api/applications/[id]/route.ts`,
`app/api/candidates/[id]/resumes/route.ts`,
`app/api/candidates/[id]/route.ts`,
`app/api/natively/download/route.ts`,
`app/api/natively/generate/route.ts`,
`app/api/natively/status/route.ts`, `app/applications/[id]/page.tsx`,
`app/natively/page.tsx`, `docker-compose.yml`, `e2e/flow.spec.ts`,
`lib/ai/providers.ts`, `lib/db.ts`, `lib/natively.ts`,
`lib/parse/pdf.ts`, `lib/rag.ts`, `lib/security.ts`, `lib/types.ts`,
`middleware.ts`, `package.json`, `tests/api/cascade.test.ts`,
`tests/api/natively.test.ts`, `types/pdf-parse.d.ts`.

New (27 files/dirs): `REMEDIATION_PLAN.md`, `REMEDIATION_REPORT.md`
(this file), `app/api/auth/`, `app/api/natively/{confirm,delete,preview,
settings,versions}/`, `app/login/`, `db/migrations/002_remediation.sql`,
`lib/ai/structured.ts`, `lib/auth.ts`, `lib/cleanup.ts`, `lib/context.ts`,
`lib/secrets.ts`, `lib/session.ts`, `scripts/smoke-live-ai.mjs`,
`tests/api/{ai-settings-security,auth,natively-lifecycle}.test.ts`,
`tests/unit/{context,natively-build,pdf-ocr,providers,ratelimit,
secrets,upload-validation}.test.ts`.

## Migrations

- `db/migrations/002_remediation.sql`: `skills_sync` gains
  `resume_version`, `jd_hash`, `content_hash`, `version_number`; new
  `skill_versions` table (FK cascade on `skills_sync`); `ai_settings`
  gains `skill_context_chars`. The migration loader (`lib/db.ts`) now
  runs all `db/migrations/*.sql` in order, tracked in
  `schema_migrations`, tolerating duplicate-column errors on re-run.
  Verified on a fresh DB (both migrations applied) and on the existing
  `./data` DB (ALTERs applied idempotently).

## Tests executed — actual results (2026-11-16)

| Check | Result |
| --- | --- |
| `npm test` (Vitest) | **180 passed, 0 failed** (28 files). Includes the new regression suites: two resumes/two companies Skill correctness, lifecycle (file_written → imported → activation_verified, activation-before-import 409, duplicate slug `-2` no-overwrite, regenerate 409 + version save + JD-change outdated + restore), permanent candidate delete removes uploads + Skills (filesystem asserted), application delete preserves other app + resumes, invalid/scanned PDF handling, OpenRouter/Ollama failure + fallback, cross-candidate isolation, injection payload (no secret leak), credential encryption/masking/re-encryption, auth (login required when `APP_PASSWORD` set, remote 403 without it), rate-limit memory bound + spoofed-header ignored, backup/restore (keys excluded). |
| Playwright E2E (`npm run test:e2e`) | **1 passed** — full flow plus the Skill lifecycle (Generate → `file_written` → Mark imported → Mark activation verified). |
| `npx tsc --noEmit` | **Clean, exit 0.** (Note: an earlier run in the sprint showed only stale `.next/types` TS6053 errors from a previous build; a fresh `npm run build` regenerates `.next` and the check passes.) |
| `npm run build` | **Clean** — 13/13 pages + `/login`, middleware 27.9 kB. |
| Live smoke on the production build | Fresh temp DB: candidate → resume upload (auto-import parsing extracted name/headline) → application → JD → Skill generated, status `file_written`, file on disk → backup export contained **no** `openrouter_key` → `PRAGMA integrity_check` **ok**, `PRAGMA foreign_key_check` **empty** → server restart, candidate persisted → permanent delete removed **3 files**, `uploads/` and `skills/` empty. Server stopped, temp dirs removed. |
| `npm audit` | **Not runnable here** — registry policy 403 `policy_denied` (see defect 19). |
| Docker build | **Not runnable here** — no Docker binary in the sandbox. `docker compose config` validation was not possible either. |

Three real defects were found by the tests during the sprint and fixed,
not suppressed: (a) the truncation note lacked the total omitted count;
(b) the confirm route mapped action `activated` to status
`activation_verified` inconsistently (400 instead of 409); (c) the
cascade test seeded a Skill without a JD, which the new spec-correct
generator refuses (JD is required — spec §4 step 4); the test now seeds
a JD before generating.

## Follow-up fix (same day, after the first push)

The security track's completion report flagged two gaps that were fixed,
verified, and pushed after the four commits above:

- **`lib/api.ts` did not send the CSRF header.** With `APP_PASSWORD`
  set, every mutating UI call would have 403'd on CSRF. The fetch
  wrapper now reads the JS-readable `ih_csrf` cookie and echoes it as
  `x-ih-csrf` on mutating calls (absent without auth, so no behaviour
  change when auth is off). Verified live against the production build
  with `APP_PASSWORD` set: no session → 401; session without the header
  → 403; session + header (the `lib/api.ts` flow) → 201.
- **`app/api/candidates/parse-resume/route.ts` skipped magic-byte
  validation** (extension check only). It now calls
  `validateUploadBytes` before extraction; a `.txt` renamed to `.docx`
  returns 400. Regression test added
  (`tests/api/auto-import.test.ts`, now 11 tests).

## Remaining limitations (honest)

- **Docker build untested** — no Docker in this sandbox. Verify
  `docker compose up --build` on a machine with Docker before relying
  on it.
- **Live AI untested** — no OpenRouter key, no Ollama in this sandbox.
  Mocked provider tests pass; run `npm run smoke:live-ai` with a real
  provider configured to verify live integration.
- **OCR requires tesseract and has no page renderer** — scanned PDFs are
  detected and held in needs-review, but actual OCR text extraction
  cannot run until a page renderer is added (see defect 13).
- **Keychain is macOS-only** — on Linux/Windows the encrypted-file store
  is used.
- **`npm audit` blocked by sandbox registry policy** — Next 14.2.18's
  flagged vulnerability unevaluated (see defect 19).
- **DOCX extraction not route-tested** — DOCX magic-byte validation is
  unit-tested; extraction is library code only. Worth a manual check
  with a real .docx.
- **No concurrency testing** — single-user local tool by design.

## Install / startup

```bash
git clone https://github.com/sairamcharanbethu/interviewhub.git
cd interviewhub
cp .env.example .env   # optional: INTERVIEWHUB_SECRET, APP_PASSWORD, TRUST_PROXY
npm install
npm run dev            # or: npm run build && npm start   (binds 127.0.0.1:3000)
```

Optional env vars: `INTERVIEWHUB_SECRET` (key-encryption secret; if
unset, a `data/.secret-key` is generated), `INTERVIEWHUB_USE_KEYCHAIN=1`
(macOS Keychain instead of the encrypted DB column),
`APP_PASSWORD` (enable login), `TRUST_PROXY=1` (honour
`X-Forwarded-For` behind a reverse proxy), `SKILLS_DIR` (default
`data/skills/`), `DATA_DIR`, `OPENROUTER_API_KEY`, `OLLAMA_BASE_URL`.
