import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

export function dataDir(): string {
  const d = process.env.DATA_DIR || './data';
  return path.isAbsolute(d) ? d : path.resolve(process.cwd(), d);
}
export function dbPath(): string {
  return path.join(dataDir(), 'interviewhub.db');
}

let instance: Database.Database | null = null;

export function db(): Database.Database {
  if (instance) return instance;
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
  const conn = new Database(dbPath());
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  // Lightweight forward-migration for columns added after 001_init shipped.
  // Runs BEFORE the migration file: 001_init.sql creates an index on
  // document_chunks(source_type), so on a pre-existing DB the column must
  // already be present or conn.exec(mig) below fails on that index.
  const tableExists = (t: string) => conn.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  if (tableExists('ai_settings')) {
    const aiCols = conn.prepare(`PRAGMA table_info(ai_settings)`).all() as Array<{ name: string }>;
    if (!aiCols.some((c) => c.name === 'redact_pii')) {
      conn.exec(`ALTER TABLE ai_settings ADD COLUMN redact_pii INTEGER NOT NULL DEFAULT 0`);
    }
  }
  if (tableExists('document_chunks')) {
    const chunkCols = conn.prepare(`PRAGMA table_info(document_chunks)`).all() as Array<{ name: string }>;
    if (!chunkCols.some((c) => c.name === 'source_type')) {
      conn.exec(`ALTER TABLE document_chunks ADD COLUMN source_type TEXT NOT NULL DEFAULT 'resume'`);
    }
  }
  // Run every migration in db/migrations in filename order, tracked in
  // schema_migrations so each file applies once. ADD COLUMN statements are
  // skipped when the column already exists (idempotent re-runs and
  // databases that predate a migration file).
  conn.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const applied = new Set(
    (conn.prepare(`SELECT filename FROM schema_migrations`).all() as Array<{ filename: string }>).map((r) => r.filename),
  );
  const migDir = path.join(process.cwd(), 'db', 'migrations');
  const files = fs.existsSync(migDir) ? fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort() : [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migDir, file), 'utf8');
    // Split on statement boundaries conservatively: migrations are written
    // one statement per block separated by blank lines + semicolons.
    const statements = sql
      .split(/;\s*\n/)
      .map((s) =>
        s
          .split('\n')
          .filter((l) => !l.trim().startsWith('--'))
          .join('\n')
          .trim(),
      )
      .filter(Boolean);
    for (const stmt of statements) {
      const text = stmt.endsWith(';') ? stmt : `${stmt};`;
      try {
        conn.exec(text);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/duplicate column name/i.test(msg)) continue; // already applied
        throw e;
      }
    }
    conn.prepare(`INSERT INTO schema_migrations (filename) VALUES (?)`).run(file);
  }
  instance = conn;
  return conn;
}

export function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}
export function get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}
export function run(sql: string, ...params: unknown[]): Database.RunResult {
  return db().prepare(sql).run(...params);
}
export function transaction<T>(fn: (txDb: Database.Database) => T): T {
  const conn = db();
  const wrapped = conn.transaction(fn);
  return wrapped(conn);
}
export function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
export function newId(prefix = ''): string {
  return `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
export function parseJson<T>(v: string | null | undefined, fallback: T): T {
  if (!v) return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}
