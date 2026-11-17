# USER_GUIDE.md

## The flow

The fastest path is **Prepare Interview** (`/prepare`, also the hero on the
Dashboard): upload a resume and a job description, click **Prepare
Interview**, and InterviewHub does the whole flow in the background —
Candidate → Resume → Application → JD → Match → Prep → Skill — then
installs the Skill into Natively. Watch the progress screen (plain-language
stages), then the results screen tells you the match score, how many
questions and STAR drafts were made, whether each part came from AI or the
labelled template fallback, and the next step ("Open Natively and use
/<skill-slug>"). If a stage fails, the job finishes as "partial" and you can
retry just the failed stages from the results screen — retrying never
creates a second candidate or application.

First time only: you will be asked once to confirm Natively's Skills
directory. If you skip it, preparation still runs; the install step is
recorded as failed and the results screen offers the confirm + install
action. No AI provider is required: if none is configured, everything is
built from templates and labelled "Template fallback — AI unavailable".
To enable AI, set an OpenRouter key once in AI Settings, or sign in with
`codex login` / the Antigravity app on your Mac (AI Settings shows each
provider's status and lets you reorder the priority).

InterviewHub follows one flow: **Candidate → Resume → Application → JD →
Match → Prep → Skill**. Everything else (STAR stories, settings, backup)
supports that flow.

## 1. Candidates — start from the resume, not a blank form

`/candidates` — the fastest path is **Create from resume**: upload a PDF,
DOCX, TXT or MD resume and the profile form opens pre-filled — name,
email, phone, location, headline, summary, experience, skills,
employment, education and certifications, each marked "Filled from
resume". **Check and edit every field before saving**; anything the resume
did not state is left blank, and nothing is invented. On save, the same
file is attached as the candidate's v1 resume. The manual **+ New
candidate** form is still there when there is no resume yet.

One candidate can be the **default** (it is pre-selected across pages).
Candidates can be **archived** (hidden until "Show archived") and
**restored**; soft-deleted candidates can be restored from the same page,
and permanently deleted from **Settings → Danger zone**.

## 2. Resumes

Open a candidate → **Upload resume** (PDF, DOCX, TXT, MD; max 10 MB). The
file is parsed (name, location, headline, summary, experience, skills,
employment with employer + title split, education, certifications,
quality score) and chunked for search/AI retrieval. Each upload becomes a
new **version** and is set active; older versions stay listed and can be
re-activated or deleted. Click **View text** to see the extracted text and
parsed fields — **Apply parsed data to profile** merges the parsed skills
and fills any **blank** profile field from the resume. Fields you already
filled are never overwritten, and parsing is heuristic, never
auto-applied.

## 3. Applications — start from the job posting, not a blank form

`/applications` — the fastest path is **Add from job link / JD**: paste a
job URL, paste the job description text, or upload a JD file. The posting
is read and the form opens pre-filled — company, role title, location and
employment type, each marked "Filled from the job posting", with the full
JD text attached. **Check and edit before saving**; company or title the
posting did not state are left blank for you to fill in. Saving lands you
on the application detail page with the JD already saved, so **Run Match**
is one click away. The manual **+ New application** form is untouched.

**Duplicate** copies an application for a re-application. **Archive /
Restore** hides and brings back an application; **Delete** soft-deletes it
(resumes and STAR stories are untouched — they belong to the candidate, not
the application).

## 4. Job description

Open an application → paste the JD into **Job description** and **Save JD
text** (or **Import from URL**). The JD is parsed (required/preferred
skills, experience, certifications) and chunked for retrieval. Pasting is
the reliable path; URL import needs the posting to be publicly fetchable.
**LinkedIn blocks server-side fetching** (login wall / 403), as do most
JavaScript-only job pages — for those, paste the job description text;
the app says so plainly instead of silently saving an empty JD.

## 5. Match

On the application page, **Run Match** scores the active resume against the
JD: per-requirement evidence, an overall score, and a summary. Anything
without evidence reads **Not demonstrated** — that is the system refusing to
guess, not a bug. Tick **AI refine** only if you have a provider configured
(see below); the AI can only confirm grounded evidence, never invent skills.

## 6. Prep

On the application page, **Generate questions** produces interview questions
from the JD and resume. With no AI provider configured you get the offline
template set (labelled as such) — it is still JD-specific (keywords drive
the technical questions). **Generate answers** drafts first-person answers
from resume/STAR evidence only, marking gaps as **Not demonstrated**.
**Save interview session** stores a question/answer set on the application.

## 7. STAR stories

`/star` — reusable Situation–Task–Action–Result stories per candidate.
**Generate AI draft** (optional role/theme hint) drafts one story from the
candidate's resume evidence and opens it in the create form as an **unsaved
draft** — review every claim, edit, then create. Mark a story **verified**
only after checking every claim against the resume or records; answers cite
verified stories first. Drafts are never auto-verified.

## 8. Natively skills

On the application page, **Preview** shows the exact Skill content first;
**Generate Natively Skill** writes the standalone
`interview-<candidate>-<company>-<role>.md` (into `SKILLS_DIR`, default
`./data/skills/`) containing the candidate summary, the selected resume's
evidence, the JD, and STAR stories, plus the factual-accuracy rules.
**Download** fetches the file, **Copy file path** copies its absolute path,
**Version history** restores any previous version, and **Delete Skill**
removes the file (the application and resumes are untouched). `/natively`
lists all generated skills with their lifecycle status.

Statuses: `file_written` (file exists on disk — this is all generation
proves), `awaiting_import`, `imported`, `activation_verified`, `outdated`
(resume or JD changed since generation — regenerate), `failed`, plus
`installed`, `update_available`, `installation_failed`, `uninstalled` for
automatic installs. Import the file in Natively yourself (open Natively →
Skills → add the `interview-*.md` file → confirm → activate → test with a
question), then click **Mark as imported** and **Mark activation verified**
— those are the only way a Skill becomes "imported" or "activated" in
InterviewHub. If two applications share a company and role, the second
Skill gets a `-2` suffix instead of overwriting the first.

**Automatic install (optional):** on the application page or `/natively`,
**Install to Natively** writes the Skill straight into Natively's Skills
directory (`<dir>/<slug>/SKILL.md`). The Natively page shows the resolved
directory and whether it was verified. On macOS the default is
`~/Library/Application Support/Natively/skills/`; set `NATIVELY_SKILLS_DIR`
in `.env` to override it (absolute path). If the directory cannot be
verified — e.g. Natively is not installed yet — installation is blocked
until you install Natively or confirm the directory in the app; the manual
Download above always works instead. After installing, bring Natively to
the front — it re-reads the Skills folder when its window regains focus,
so no restart is needed. "Installed" means the file was written there, not
that Natively loaded it; confirm import/activation in Natively as above.
**Update in Natively** reinstalls after a resume or JD change;
**Uninstall** removes only that application's Skill folder.

## 9. AI Settings

`/ai-settings` — providers and per-task routing:

- **OpenRouter API key** — saved in the DB (masked in the UI, last 4 shown).
  Leave blank to keep the saved key; tick "Clear the saved key" to remove it.
- **OpenRouter / Ollama model** — dropdowns populated from the provider
  (via `GET /api/ai-settings/models`); if the provider is unreachable the
  field stays a free-text input.
- **Default provider** — Ollama (local) or OpenRouter (cloud).
- **Per-task routing** — provider + model per task (`match`, `questions`,
  `answers`, `skillgen`, `star`, `general`). Leave the model blank to use
  that provider's default model above.
- **Test connection** buttons check each provider; **Refresh model lists**
  reloads the dropdowns.
- **Usage** lists recorded AI calls and total cost (OpenRouter only; Ollama
  is local, cost $0).

No provider configured? Everything still works: matching uses the
deterministic heuristic, questions/answers use templates, STAR drafts report
"no AI provider configured" instead of failing.

## 10. Search

`/documents` — search across the selected candidate's documents (resumes,
JDs, notes). Search is always scoped to one candidate; there is no
cross-candidate search by design.

## 11. Settings & backup

`/settings` — data counts, **Download backup (JSON)**, **Restore from backup
file…**, and the danger zone (permanent deletes). See `BACKUP.md` for the
backup format and restore semantics.

## Tips

- Keep one candidate as default so new applications pre-select them.
- Paste JDs as text — URL import fails on JS-heavy or login-walled postings.
- If a match score looks wrong, open the resume's **View text** first: a bad
  parse (e.g. a two-column PDF) is the usual cause, not the scorer.
- Treat every AI draft/answer as unverified until you have read it.
