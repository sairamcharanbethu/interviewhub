# BACKUP.md

## Format

`POST /api/backup/export` returns JSON:

```json
{
  "version": 1,
  "exported_at": "2026-11-15T12:00:00.000Z",
  "tables": {
    "workspaces": [ ... ],
    "candidates": [ ... ],
    "resumes": [ ... ],
    "applications": [ ... ],
    "star_stories": [ ... ],
    "interview_sessions": [ ... ],
    "ai_settings": [ { "id": 1, "openrouter_model": "...", "ollama_base_url": "...", "ollama_model": "...", "default_provider": "ollama", "routing": "{...}", "fallback_model": null, "redact_pii": 0 } ],
    "ai_usage": [ ... ],
    "skills_sync": [ ... ],
    "document_chunks": [ ... ]
  }
}
```

Notes:

- `candidates` and `applications` export only non-deleted rows
  (`deleted_at IS NULL`); everything else exports all rows.
- `ai_settings` is exported **without `openrouter_key`** — the key is never
  in a backup. All other `ai_settings` columns are included.
- `document_chunks` rows are included; the FTS5 index is rebuilt on
  restore, so the index itself is not part of the backup.

## Export

- UI: **Settings → Backup → Download backup (JSON)**.
- API: `curl -X POST http://localhost:3000/api/backup/export -o backup.json`

## Restore

- UI: **Settings → Backup → Restore from backup file…** (pick the JSON).
- API: `curl -X POST http://localhost:3000/api/backup/restore -H 'Content-Type: application/json' --data @backup.json`

Semantics:

- **Merge by id** — rows are inserted with `INSERT OR REPLACE`, so a restore
  overwrites rows with the same id and adds new ones. It never deletes rows
  that aren't in the backup. Restoring an old backup over newer data will
  roll those rows back to the backup's state.
- **Tables allow-list** — `workspaces`, `candidates`, `resumes`,
  `applications`, `star_stories`, `interview_sessions`, `ai_settings`,
  `ai_usage`, `skills_sync`, `document_chunks`. Any other table in the file
  rejects the whole restore with 400 (the transaction rolls back).
- **`ai_settings` is restored, key excluded** — the non-secret fields
  (models, URLs, default provider, routing, fallback model, `redact_pii`)
  restore normally. If a backup file contains an `openrouter_key` (e.g. a
  hand-edited file), the API drops that column on restore. After a restore,
  re-enter the OpenRouter key in AI Settings if you use OpenRouter.
- **FTS rebuild** — after the rows land, the restore deletes and rebuilds
  `document_chunks_fts` from `document_chunks`, so search works immediately.
- **Files are not in the backup** — uploaded resumes (`data/uploads/`) and
  generated skills (`data/skills/`) are files on disk, not DB rows. A JSON
  backup alone does not restore them; copy the `data/` directory too for a
  full backup. A restored resume row whose file is missing will show its
  parsed text (stored in the DB) but its stored file will be gone.

## What a restore does NOT do

- It does not delete anything not in the backup.
- It does not restore the OpenRouter key.
- It does not restore uploaded files or generated skill files.
- It does not validate foreign keys beyond what SQLite enforces; restoring
  a partial backup (e.g. applications without their candidate) can leave
  orphaned rows that the UI may not display.

## Suggested routine

1. Before any risky operation (bulk delete, upgrade, migration), download a
   backup from Settings and copy the whole `data/` directory aside.
2. Keep backups out of shared folders — they contain personal data
   (resumes, applications, STAR stories). See `SECURITY.md`.
