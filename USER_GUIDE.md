# USER_GUIDE.md

## The flow

InterviewHub follows one flow: **Candidate → Resume → Application → JD →
Match → Prep → Skill**. Everything else (STAR stories, settings, backup)
supports that flow.

## 1. Candidates

`/candidates` — create a profile with name, contact, location, headline,
experience, skills, certifications. One candidate can be the **default**
(it is pre-selected across pages). Candidates can be **archived** (hidden
until "Show archived") and **restored**; soft-deleted candidates can be
restored from the same page, and permanently deleted from **Settings →
Danger zone**.

## 2. Resumes

Open a candidate → **Upload resume** (PDF, DOCX, TXT, MD; max 10 MB). The
file is parsed (skills, employment, education, certifications, quality
score) and chunked for search/AI retrieval. Each upload becomes a new
**version** and is set active; older versions stay listed and can be
re-activated or deleted. Click **View text** to see the extracted text and
parsed skills — **Approve parsed skills onto profile** copies the parsed
skills onto the candidate (this is a deliberate, manual step; parsing is
heuristic and never auto-applied).

## 3. Applications

`/applications` — create an application (candidate, company, role title,
status, dates, notes). **Duplicate** copies it for a re-application.
**Archive / Restore** hides and brings back an application; **Delete**
soft-deletes it (resumes and STAR stories are untouched — they belong to the
candidate, not the application).

## 4. Job description

Open an application → paste the JD into **Job description** and **Save JD
text** (or **Import from URL**). The JD is parsed (required/preferred
skills, experience, certifications) and chunked for retrieval. Pasting is
the reliable path; URL import needs the posting to be publicly fetchable.

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

On the application page, **Generate SKILL.md** writes
`interview-<candidate>-<company>-<role>.md` (into `SKILLS_DIR`, default
`./data/skills/`) containing the candidate summary, resume/JD excerpts and
STAR stories, plus the factual-accuracy rules. **Download SKILL.md** fetches
the file. `/natively` lists all generated skills and their sync status.

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
