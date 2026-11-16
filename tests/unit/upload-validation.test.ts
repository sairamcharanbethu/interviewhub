import { describe, expect, it } from 'vitest';
import { validateUploadBytes } from '@/lib/security';

const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n', 'latin1');
const TXT = Buffer.from('Naga Iswarya Lakshmi Bhogadi\nOracle DBA\n', 'utf8');
// Minimal DOCX-shaped bytes: ZIP local-file header + the package marker.
const DOCX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]),
  Buffer.from('[Content_Types].xml'),
  Buffer.from([0x00, 0x01, 0x02]),
]);
const DOCX_NO_MARKER = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('some other zip content, no word package marker'),
]);

describe('validateUploadBytes', () => {
  it('accepts a valid PDF (magic %PDF)', () => {
    expect(validateUploadBytes('resume.pdf', PDF, 'application/pdf')).toEqual({ ok: true, kind: 'pdf' });
  });

  it('rejects a .txt renamed to .pdf', () => {
    const r = validateUploadBytes('resume.pdf', TXT, 'application/pdf');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/PDF/);
  });

  it('accepts a real DOCX zip containing [Content_Types].xml', () => {
    expect(
      validateUploadBytes(
        'resume.docx',
        DOCX,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toEqual({ ok: true, kind: 'docx' });
  });

  it('rejects a .txt renamed to .docx (no ZIP header)', () => {
    const r = validateUploadBytes('resume.docx', TXT, 'application/octet-stream');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/DOCX/);
  });

  it('rejects a ZIP without the Word package marker', () => {
    const r = validateUploadBytes('resume.docx', DOCX_NO_MARKER, 'application/octet-stream');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/DOCX/);
  });

  it('accepts valid UTF-8 txt/md', () => {
    expect(validateUploadBytes('notes.txt', TXT, 'text/plain')).toEqual({ ok: true, kind: 'txt' });
    expect(validateUploadBytes('notes.md', Buffer.from('# Hello\n', 'utf8'), 'text/markdown')).toEqual({ ok: true, kind: 'md' });
  });

  it('rejects invalid UTF-8 in txt', () => {
    const r = validateUploadBytes('notes.txt', Buffer.from([0xff, 0xfe, 0xfd, 0x41]), 'text/plain');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/UTF-8/);
  });

  it('rejects empty buffers and disallowed extensions', () => {
    expect(validateUploadBytes('empty.txt', Buffer.alloc(0), 'text/plain').ok).toBe(false);
    const exe = validateUploadBytes('evil.exe', Buffer.from('MZ...'), 'application/octet-stream');
    expect(exe.ok).toBe(false);
  });

  it('rejects extension/MIME mismatches', () => {
    const r = validateUploadBytes('resume.pdf', PDF, 'application/x-msdownload');
    expect(r.ok).toBe(false);
    // Browsers may send a generic MIME for txt — allowedUpload() permits that.
    expect(validateUploadBytes('notes.txt', TXT, 'application/octet-stream').ok).toBe(true);
  });
});
