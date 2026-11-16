# InterviewHub — Production-Readiness Remediation Plan

Date: 2026-11-16. Base: commit `b94c465` (v1) + sibling auto-import work in progress (uncommitted at plan time).

## Defects found by inspection (before any fix)

| # | Defect | Evidence | Severity |
|---|--------|----------|----------|
| 1 | Skill generation ignores `applications.selected_resume_id` | `lib/natively.ts loadApplicationContext()` always picks `is_active=1` resume | Critical — wrong resume in Skills, match/prep can diverge (match route already honours selection) |
| 2 | Writing a Skill file marks it `synced` | `app/api/natively/generate/route.ts` inserts status `'synced'` | Critical — file creation is not Natively import/activation |
| 3 | No Skill version history / restore; silent overwrite on slug collision | `writeSkillFile()` renames tmp over existing file; no versions table | High |
| 4 | Silent truncation in Skills | `buildSkillMd()` slices resume to 6000 chars, JD to 4000, no warning | High |
| 5 | Permanent candidate delete leaves orphan files | Candidate DELETE only deletes DB rows (+ FTS purge); `data/uploads/<id>/` and generated Skill files remain | High (documented) |
| 6 | Application delete leaves its Skill files | Same pattern as #5, scoped to the application | High |
| 7 | OpenRouter key stored plaintext in SQLite | `ai_settings.openrouter_key`, returned masked only, but stored raw; included in no backup (already stripped) | High |
| 8 | No authentication; app unauthenticated single-user | No middleware auth; `next start` binds 0.0.0.0 by default | High |
| 9 | Rate limiter unbounded + trusts X-Forwarded-For | `lib/security.ts` `hits` Map grows forever; `middleware.ts` trusts XFF blindly | Medium |
| 10 | Upload validation trusts browser MIME, no magic bytes | `allowedUpload()` checks extension + claimed MIME only | Medium |
| 11 | Scanned/image-only PDFs silently "processed" | `lib/parse/pdf.ts` returns empty text; resume row created with quality score from other signals | Medium |
| 12 | No OCR fallback | No tesseract integration | Medium |
| 13 | Docker: Ollama URL defaults to container localhost | `docker-compose.yml` `OLLAMA_BASE_URL=http://localhost:11434` — wrong inside a container | Medium |
| 14 | Docker: no HEALTHCHECK, no tesseract, `npm start` | `Dockerfile` | Low–Medium |
| 15 | Frontmatter not escaped; slug collision overwrites unrelated app's Skill | `buildSkillMd()` interpolates names into YAML; `writeSkillFile()` no ownership check | Medium |
| 16 | AI prompt protection is regex-only | `lib/ai/prompts.ts` stripInjection only | Medium |
| 17 | `npm audit` blocked in sandbox | Registry policy denies `/-/npm/v1/security/audits/quick` (403 policy_denied) — cannot run audit here; lockfile review only | Process |
| 18 | Docker build cannot be verified here | No Docker binary in sandbox | Process — record as untested, never claim otherwise |
| 19 | Live AI (OpenRouter/Ollama) cannot be verified here | No key, no Ollama in sandbox | Process — mocked tests + opt-in live smoke script only |

## Fix plan (phases, in order)

- **Phase 1 (this sprint, main agent):** shared resume resolver (`lib/context.ts`); Natively lifecycle statuses + version history + outdated detection (migration `002`); deletion file cleanup; Skill generation safety (frontmatter escaping, slug suffix on collision, RAG-based excerpts with truncation warning).
- **Phase 2 (subagent, security track):** AES-256-GCM key encryption (+ macOS Keychain when available), optional `APP_PASSWORD` auth + CSRF + login rate limit, localhost-only default, bounded rate limiter honouring XFF only with `TRUST_PROXY=1`, magic-byte upload validation.
- **Phase 3 (subagent, docs/AI/Docker track):** scanned-PDF detection + OCR availability reporting, structured-prompt builder + JSON schema validation, mocked provider failure/fallback tests, live smoke script (opt-in only), Dockerfile/Compose fixes (ARM64, healthcheck, tesseract, host Ollama).
- **Phase 4 (main agent, after tracks land):** wire structured prompts into match/prep, extend Playwright E2E with Skill lifecycle, full test/build/tsc run, docs updates, `REMEDIATION_REPORT.md`, push to GitHub.

## Sequencing / collision rules

- Sibling auto-import agent owns (uncommitted at plan time): `app/api/applications/[id]/jd/route.ts`, `app/applications/page.tsx`, `app/candidates/[id]/page.tsx`, `app/candidates/page.tsx`, `components/*Form.tsx`, `lib/parse/jd.ts`, `lib/parse/resume.ts`, `lib/types.ts`, `tests/unit/jd.test.ts`, `tests/unit/resume.test.ts`, `app/api/applications/parse-jd/`, `app/api/candidates/parse-resume/`, `lib/parse/fetch-url.ts`, `tests/api/auto-import.test.ts`. Do not edit until its commit lands; then rebase/merge before pushing.
- Security track owns: `lib/secrets.ts`, `lib/auth.ts`, `lib/security.ts`, `middleware.ts`, `app/api/ai-settings/route.ts`, `app/api/auth/*`, `app/login/*`, `.env.example` (secret/auth vars).
- Docs/AI/Docker track owns: `lib/parse/pdf.ts`, `lib/ai/structured.ts`, `tests/unit/providers.test.ts`, `tests/unit/pdf-ocr.test.ts`, `scripts/smoke-live-ai.mjs`, `Dockerfile`, `docker-compose.yml`. It may append one function to `lib/ai/providers.ts` and add scanned-detection to the resumes route — coordinate by reading first.
- Main agent owns: `lib/context.ts`, `lib/natively.ts`, `lib/db.ts` (migration loader), `db/migrations/002_*`, `app/api/natively/*`, candidate/application DELETE routes, match + prep routes, `lib/rag.ts` (resume-scoped retrieval), `lib/match.ts`, `lib/prep.ts`, `app/applications/[id]/page.tsx`, `app/natively/page.tsx`, docs + final report + push.

## Acceptance criteria

- All Phase 1–6 mandatory scenarios pass or are explicitly recorded untested with reason (Docker build, live AI).
- `npm test`, `npm run test:e2e`, `npx tsc --noEmit`, `npm run build` green; `PRAGMA integrity_check` + `foreign_key_check` clean; backup/restore round-trip with key excluded.
- No test suppressed; no live-provider or Docker claim made from mocked/unrun checks.
