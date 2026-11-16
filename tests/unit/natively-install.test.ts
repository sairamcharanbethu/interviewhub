import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTempDir, makeTempDataDir } from '../helpers';

const dir = makeTempDataDir();
let installLib: typeof import('@/lib/natively-install');
let filesLib: typeof import('@/lib/files');
let dbLib: typeof import('@/lib/db');

beforeAll(async () => {
  installLib = await import('@/lib/natively-install');
  filesLib = await import('@/lib/files');
  dbLib = await import('@/lib/db');
});

afterAll(() => {
  delete process.env.NATIVELY_SKILLS_DIR;
  cleanupTempDir(dir);
});

describe('validateInstallSlug', () => {
  it('accepts a normal interview slug', () => {
    expect(installLib.validateInstallSlug('interview-naga-harris-computer-oracle-dba')).toEqual({ ok: true });
  });
  it('rejects path traversal and separators', () => {
    expect(installLib.validateInstallSlug('../etc')).toEqual(expect.objectContaining({ ok: false }));
    expect(installLib.validateInstallSlug('interview-a/b')).toEqual(expect.objectContaining({ ok: false }));
    expect(installLib.validateInstallSlug('interview-a\\b')).toEqual(expect.objectContaining({ ok: false }));
  });
  it('rejects uppercase, spaces, and non-interview slugs', () => {
    expect(installLib.validateInstallSlug('Interview-A')).toEqual(expect.objectContaining({ ok: false }));
    expect(installLib.validateInstallSlug('interview-a b')).toEqual(expect.objectContaining({ ok: false }));
    expect(installLib.validateInstallSlug('epsilon-senior-dba')).toEqual(expect.objectContaining({ ok: false }));
  });
  it('rejects built-in Natively slugs and over-long slugs', () => {
    expect(installLib.validateInstallSlug('humanize-ai-text')).toEqual(expect.objectContaining({ ok: false }));
    expect(installLib.validateInstallSlug('humanize-text')).toEqual(expect.objectContaining({ ok: false }));
    expect(installLib.validateInstallSlug(`interview-${'a'.repeat(80)}`)).toEqual(expect.objectContaining({ ok: false }));
    expect(installLib.validateInstallSlug('')).toEqual(expect.objectContaining({ ok: false }));
  });
});

describe('installSlugFor', () => {
  it('caps the slug at 80 chars without a trailing hyphen', () => {
    const long = `interview-${'a'.repeat(50)}-${'b'.repeat(50)}`;
    const slug = installLib.installSlugFor(long);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
    expect(installLib.validateInstallSlug(slug).ok).toBe(true);
  });
  it('keeps short names unchanged', () => {
    expect(installLib.installSlugFor('interview-naga-harris-dba')).toBe('interview-naga-harris-dba');
  });
});

describe('macOS default directory', () => {
  it('handles spaces in the home path', () => {
    const p = filesLib.macosDefaultNativelySkillsDir('/Users/Test User');
    expect(p).toBe('/Users/Test User/Library/Application Support/Natively/skills');
  });
});

describe('resolveNativelySkillsDir', () => {
  it('rejects a relative NATIVELY_SKILLS_DIR', () => {
    process.env.NATIVELY_SKILLS_DIR = 'relative/skills';
    const info = filesLib.resolveNativelySkillsDir();
    expect(info.resolved_path).toBeNull();
    expect(info.error).toMatch(/absolute/);
  });
  it('verifies an existing absolute directory from env', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-nat-'));
    process.env.NATIVELY_SKILLS_DIR = target;
    const info = filesLib.resolveNativelySkillsDir();
    expect(info.configured).toBe(true);
    expect(info.source).toBe('env');
    expect(info.resolved_path).toBe(target);
    expect(info.verified).toBe(true);
    expect(info.exists).toBe(true);
    expect(info.is_directory).toBe(true);
    fs.rmSync(target, { recursive: true, force: true });
  });
  it('reports can_create when the parent exists but the dir does not', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-nat-parent-'));
    const target = path.join(parent, 'skills');
    process.env.NATIVELY_SKILLS_DIR = target;
    const info = filesLib.resolveNativelySkillsDir();
    expect(info.verified).toBe(false);
    expect(info.can_create).toBe(true);
    expect(info.exists).toBe(false);
    fs.rmSync(parent, { recursive: true, force: true });
  });
  it('reports a file (not a directory) as unverified with an error', () => {
    const file = path.join(dir, 'not-a-dir');
    fs.writeFileSync(file, 'x');
    process.env.NATIVELY_SKILLS_DIR = file;
    const info = filesLib.resolveNativelySkillsDir();
    expect(info.verified).toBe(false);
    expect(info.error).toMatch(/not a directory/);
  });
  it('is unconfigured when the env var is unset on a non-macOS platform', () => {
    delete process.env.NATIVELY_SKILLS_DIR;
    if (process.platform !== 'darwin') {
      const info = filesLib.resolveNativelySkillsDir();
      expect(info.configured).toBe(false);
      expect(info.resolved_path).toBeNull();
      expect(info.source).toBe('unconfigured');
    }
  });
});

describe('isPathInside', () => {
  it('accepts inside paths and the root itself, rejects escapes', () => {
    expect(installLib.isPathInside('/a/b', '/a/b/c/d')).toBe(true);
    expect(installLib.isPathInside('/a/b', '/a/b')).toBe(true);
    expect(installLib.isPathInside('/a/b', '/a/bc/d')).toBe(false);
    expect(installLib.isPathInside('/a/b', '/a/../etc')).toBe(false);
  });
});

describe('resolveInstallSlug', () => {
  it('returns the base slug for the owning application', () => {
    dbLib.run(`INSERT INTO candidates (id, name, created_at, updated_at) VALUES ('cand_slug', 'Slug Cand', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`);
    for (const id of ['app_1', 'app_2', 'app_3']) {
      dbLib.run(
        `INSERT INTO applications (id, candidate_id, company, title, created_at, updated_at) VALUES ('${id}', 'cand_slug', 'Slug Corp', 'DBA', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`,
      );
    }
    dbLib.run(
      `INSERT INTO skills_sync (id, application_id, skill_name, install_slug, status) VALUES ('sync_own', 'app_1', 'interview-a', 'interview-a', 'installed')`,
    );
    expect(installLib.resolveInstallSlug('interview-a', 'app_1')).toBe('interview-a');
  });
  it('suffixes -2 / -3 when another application owns the slug', () => {
    expect(installLib.resolveInstallSlug('interview-a', 'app_2')).toBe('interview-a-2');
    dbLib.run(
      `INSERT INTO skills_sync (id, application_id, skill_name, install_slug, status) VALUES ('sync_2', 'app_2', 'interview-a-2', 'interview-a-2', 'installed')`,
    );
    expect(installLib.resolveInstallSlug('interview-a', 'app_3')).toBe('interview-a-3');
  });
});
