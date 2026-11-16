# TROUBLESHOOTING.md

## The app won't start / DB errors

- **`SQLITE_CANTOPEN` / "unable to open database file"** — `DATA_DIR` points
  somewhere the process can't write. Check the directory exists and is
  writable; the app creates it on start, but not if a parent is read-only.
  Default is `./data` next to the app.
- **"table already exists" or migration errors on start** — a stale
  `interviewhub.db` from an older schema can clash with `001_init.sql` if
  it was created by a different tool. Back it up, delete `data/`, and
  restart; then restore from a backup (see `BACKUP.md`).
- **Port 3000 in use** — `npm run start -- -p 3100` (or set `PORT`).

## Uploads / parsing

- **Upload rejected: "Only pdf, docx, txt, md files are allowed"** — the
  extension (or MIME) isn't in the allow-list. Rename/convert the file.
- **Upload rejected: "File exceeds 10MB limit"** — split the document or
  upload a `.txt` export.
- **Upload rejected: "Uploaded file is empty"** — the file has 0 bytes.
- **Resume parses poorly (missing skills, wrong employment)** — the parser
  is regex/keyword based. Two-column or table-heavy PDFs and scanned
  (image-only) PDFs parse badly. Export the resume as `.txt` or `.docx`
  and upload that instead; then use **View text** to check the extraction.
- **"No resume found" on match** — the application needs an active resume
  for its candidate (upload one, or activate an older version on the
  candidate page).

## Matching / prep

- **Match score 50 with requirements listed** — 50 is the "no requirements"
  score (empty JD). Paste the JD and **Save JD text** first.
- **Everything "Not demonstrated"** — the resume text doesn't contain the
  JD's keywords. Check **View text** on the resume: if the extraction is
  fine, the candidate genuinely doesn't evidence those requirements.
- **Prep questions are generic** — with no AI provider configured you get
  the template set. It is JD-keyword driven (technical questions use JD
  skills), but it can't know the candidate's specifics. Configure Ollama or
  OpenRouter in AI Settings for AI questions.
- **"AI provider failed" / offline fallback** — Ollama counts as
  "configured" whenever a base URL is set, so the app attempts the call and
  falls back when Ollama isn't running. Start Ollama (`ollama serve`, and
  `ollama pull llama3.1`), or switch the task's route to OpenRouter with a
  key. `GET /api/health` shows `ollama_reachable`.

## AI Settings

- **Model dropdown is a text field** — the provider's model list couldn't
  be loaded (provider unreachable, or no OpenRouter key). Type the model
  name; the field still saves. Use **Refresh model lists** after fixing
  connectivity.
- **"provider must be openrouter or ollama"** — the models endpoint only
  serves those two providers.
- **Routing changes don't seem to apply** — routing is read per call from
  the DB; save, then retry the operation. Note an empty per-task model means
  "that provider's default model" (the model fields above), not "no model".

## Natively skills

- **"Generate SKILL.md" fails** — the application must exist and
  `SKILLS_DIR` must be writable. Check `GET /api/natively/status?application_id=<id>`
  for the last sync error.
- **Skill file not where you expected** — default is
  `./data/skills/`; `SKILLS_DIR` overrides it (env or compose file).

## Backup / restore

- **Restore fails with "Table not allowed"** — the backup contains a table
  outside the allow-list. Only the app's own tables restore; edit the JSON
  to remove the foreign table, or re-export from the app.
- **Restored data doesn't show** — restore merges by id; if the row already
  existed with the same id it is overwritten, not duplicated. Hard-refresh
  the page (client state is cached in the header context).
- **AI settings didn't come back after restore** — the OpenRouter key is
  never in a backup; re-enter it in AI Settings. Models/routing do restore.

## Orphaned files

- **A permanently deleted candidate's files remain in `data/uploads/`** —
  known limitation: only resume deletes remove the stored file. Remove the
  `data/uploads/<candidateId>/` directory by hand after a permanent
  candidate delete (the candidate id is in the backup JSON if you need it).

## Tests

- **`npm test` fails with DB errors** — tests use temp dirs under the OS
  tmp directory (`DATA_DIR` is overridden per file). A failure mentioning
  `./data/interviewhub.db` means the override didn't apply — don't run
  Vitest with a `DATA_DIR` env var set in your shell.
- **`npm run test:e2e` fails: "Executable doesn't exist"** — the Chromium
  browser isn't installed: `npx playwright install chromium` (needs network
  to the Playwright CDN). Without it, E2E can't run; unit/API tests still can.
- **E2E `webServer` port clash** — the config uses port 3100; stop anything
  on 3100 first, or set a different port in `playwright.config.ts`.
