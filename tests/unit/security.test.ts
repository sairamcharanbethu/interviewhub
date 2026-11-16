import { describe, expect, it } from 'vitest';
import { allowedUpload, guardPath, safeFilename } from '@/lib/security';

describe('security helpers', () => {
  it('sanitises path-traversal filenames', () => {
    expect(safeFilename('../../etc/passwd')).not.toContain('/');
    expect(safeFilename('../../etc/passwd')).not.toContain('..');
    expect(safeFilename('my resume (final).pdf')).toMatch(/^[a-zA-Z0-9._-]+$/);
    expect(safeFilename('')).toBe('file');
  });

  it('guardPath blocks escaping the base directory', () => {
    expect(() => guardPath('/tmp/base', '../escape.txt')).toThrow('Path traversal blocked');
    expect(() => guardPath('/tmp/base', '/etc/passwd')).toThrow('Path traversal blocked');
    expect(guardPath('/tmp/base', 'sub/file.txt')).toBe('/tmp/base/sub/file.txt');
  });

  it('rejects disallowed upload types', () => {
    expect(allowedUpload('resume.pdf', 'application/pdf')).toBe(true);
    expect(allowedUpload('resume.txt', 'text/plain')).toBe(true);
    expect(allowedUpload('resume.txt', '')).toBe(true); // browsers may send empty mime
    expect(allowedUpload('evil.exe', 'application/octet-stream')).toBe(false);
    expect(allowedUpload('script.sh', 'application/x-sh')).toBe(false);
    expect(allowedUpload('resume.pdf', 'application/x-msdownload')).toBe(false);
  });
});
