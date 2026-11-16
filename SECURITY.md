# SECURITY.md

## Threat model

InterviewHub is a **local, single-user** tool. It has **no authentication or
authorization**: anyone who can reach the HTTP port can read and modify all
data, including the stored OpenRouter API key. The intended deployment is
`localhost` (or a trusted private network behind your own auth/reverse
proxy). Do not expose it directly to the internet.

## What is protected, and how

| Concern | Control |
| --- | --- |
| **API key exposure** | The OpenRouter key is stored in the `ai_settings` DB row, never returned by `GET /api/ai-settings` (only `has_openrouter_key` + last 4). It is stripped from backup exports, and the restore endpoint drops it even if a hand-crafted backup contains it. Keys are never logged (`lib/ai/providers.ts` never logs bodies/headers). |
| **Prompt injection via resume/JD content** | Resume/JD/STAR text is untrusted data. It is passed through `stripInjection` / `labelAsData` (`lib/ai/prompts.ts`) before any provider call, wrapped in `<DATA>` blocks, and system prompts state the blocks are data, never instructions. AI "demonstrated" claims are only accepted when grounded in retrieved evidence (`lib/match.ts`). |
| **Cross-candidate data leakage** | Every retrieval query is scoped by `candidate_id` (RAG `retrieveContext`, `GET /api/search`, JD chunking). Tests assert candidate A chunks are never returned for candidate B (`tests/unit/rag.test.ts`, `tests/api/search.test.ts`). |
| **Path traversal** | Upload filenames are sanitised (`safeFilename`) and all file writes go through `guardPath` (`lib/security.ts`, `lib/files.ts`). Skill files must start with `interview-`. |
| **Malicious uploads** | Extension + MIME allow-list (`pdf`, `docx`, `txt`, `md`), 10 MB cap, empty files rejected. Uploaded files are never executed; they are parsed as text. |
| **Rate limiting** | In-memory 100 req/min/IP on API routes (`middleware.ts`). This is a blunt anti-abuse control, not a security boundary. |
| **Secrets in the repo** | `.env` / `.env.local` / `.env*.local` are gitignored; `.env.example` contains no real secrets. Never commit a real key. |
| **Dependencies** | No `npm audit` gate is wired into CI here; run `npm audit` before deploying somewhere shared. |

## What is NOT protected

- **No auth.** See the threat model above.
- **No encryption at rest.** The SQLite DB, uploads, and skills are plain
  files in `DATA_DIR`. Protect the directory with filesystem permissions
  and full-disk encryption if the data matters.
- **Backups contain personal data.** A backup JSON holds all candidate,
  resume, application, and STAR data (minus the API key). Store it like any
  personal file — encrypted, not in a shared folder.
- **Ollama is trusted local.** The app calls whatever `OLLAMA_BASE_URL`
  points at with no authentication; only point it at an Ollama you run.
- **OpenRouter calls send resume/JD excerpts to a cloud provider.**
  `redact_pii` (AI Settings) strips emails/phone numbers from text sent to
  providers, but the resume content itself still leaves the machine. Use
  Ollama if the content must stay local.
- **Rate limit is per-process memory.** It resets on restart and does not
  survive multiple instances.

## Reporting a problem

This is a personal project with no security-response process. If you find a
vulnerability, fix it locally first (don't expose the instance), then record
it in `PROJECT_CHECKLIST.md` under "Known limitations" until fixed.
