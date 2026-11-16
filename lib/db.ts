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
  const mig = fs.readFileSync(path.join(process.cwd(), 'db', 'migrations', '001_init.sql'), 'utf8');
  conn.exec(mig);
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
