# Natively Skill Installation — Investigation

How automatic installation works, what was verified from Natively's own
source, and what was NOT verified (needs one manual check on the user's Mac).

## Evidence (Natively's public source, main branch)

Repository: `Natively-AI-assistant/natively-cluely-ai-assistant` (public).
All paths below are in that repo; line numbers are from the main branch as
read 2026-11-16. No Natively API, path, or behaviour in this document is
assumed — everything is either cited here or explicitly marked unverified.

| Fact | Source |
|---|---|
| Skills live in Electron `app.getPath('userData') + '/skills'` | `electron/services/SkillsManager.ts:608` |
| On macOS that is `~/Library/Application Support/Natively/skills/` | Electron `userData` convention on macOS (standard Electron behaviour, not a Natively-specific path) |
| Flat layout only: `<skillsDir>/<folder>/SKILL.md`; nested subfolders are NOT discovered | `electron/services/SkillsManager.ts:640-645` |
| The visible Skill id is the slug of the SKILL.md frontmatter `name:` field; folder name is the fallback id | `electron/services/SkillValidator.ts:174-185` |
| Frontmatter REQUIRES `name:` and `description:` (missing description → error; missing name falls back to folder name) | `SkillValidator.ts` (frontmatter validation) |
| Per-file max 100 KiB | `MAX_SKILL_FILE_BYTES` in Natively's source |
| Built-in reserved ids include `humanize-ai-text` (visible) / `humanize-text` (folder) | Natively's built-in skills |
| The Skills list re-reads the folder when the Natively window regains focus | `src/components/settings/SkillsSettings.tsx:127-129` (comment: "the list re-reads the folder when the window gets focus back") |
| There is also a skillsRefresh IPC | Natively's IPC surface (renderer ↔ main) |
| Natively's own installer stages under a unique temp dir, then renames into `<skillsRoot>/<id>/`, rolling back on failure | `electron/services/SkillInstaller.ts` |
| **There is NO public Natively API for installing a Skill** | No install endpoint/IPC is exposed to third-party apps |

## What this means for InterviewHub

- Automatic installation is a **filesystem install** into the verified
  directory above — the same mechanism Natively's own in-app upload uses.
  It is not an API integration and it does not touch Natively's licence
  checks, configuration, or any Pro feature.
- `installed` means exactly one thing: the `SKILL.md` file was written
  into the verified Natively Skills directory. It does **not** mean
  Natively loaded, enabled, or activated the Skill — InterviewHub cannot
  observe that, and it never claims otherwise.
- After installing, the user brings Natively to the front; per the cited
  source comment the list re-reads the folder on focus, so **no restart
  is required** (and none is claimed — if the Skill does not appear, the
  UI points at Skills → Refresh in Natively).
- The install slug is the existing `interview-{candidate}-{company}-{role}`
  name, truncated to Natively's 80-character slug cap. The frontmatter
  `name:` carries the full (untruncated) skill name, so the visible id in
  Natively matches the manual-export file.
- The macOS default is only *used* when the directory can be verified at
  runtime. If Natively was never installed/run, the directory does not
  exist and installation is blocked until the user either installs
  Natively or sets `NATIVELY_SKILLS_DIR` to a verified directory and
  confirms it in the UI. Nothing is ever silently written to an
  unverified location, and `data/skills/` (manual export) is never used
  as an install target.

## What was NOT verified (needs a Mac with Natively installed)

- The actual runtime refresh behaviour (focus-to-refresh) on the user's
  machine — cited from source, not observed live.
- The exact `userData` path on the user's Mac (depends on the installed
  Natively build / bundle id; the standard Electron location above is
  the expected one, and the app reports the resolved path it actually
  uses so a mismatch is visible immediately).
- Whether a Skill installed this way appears with the expected slash
  command `/<slug>` in the user's Natively build — the command is
  folder-derived per Natively's conventions; the UI labels it as such
  ("verify in Natively").
- OCR / live-AI paths are unrelated and remain as documented in
  `PROJECT_CHECKLIST.md`.

## Verification done in this sandbox (no Natively installed here)

- Install / update / duplicate-slug / foreign-folder / symlink-escape /
  unconfigured-blocked / uninstall / 100 KiB-limit flows are covered by
  `tests/unit/natively-install.test.ts` (15 tests) and
  `tests/api/natively-install.test.ts` (14 tests), all against temporary
  directories standing in for Natively's Skills directory.
- The install flow is therefore verified against temp dirs + Natively's
  source. One manual confirmation on the user's Mac is still needed:
  install a Skill, bring Natively to the front, and confirm it appears
  in the Skills list.
