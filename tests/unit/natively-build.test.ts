import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTempDir, makeTempDataDir } from '../helpers';

const dir = makeTempDataDir();
let natively: typeof import('@/lib/natively');

beforeAll(async () => {
  natively = await import('@/lib/natively');
});

afterAll(() => cleanupTempDir(dir));

const app = (over: Record<string, unknown> = {}) => ({
  company: 'Acme "Quoted" Corp',
  title: 'Oracle DBA',
  jd_text: 'We need Oracle RAC and Data Guard experience. '.repeat(50),
  notes: '',
  ...over,
});
const candidate = { name: 'Naga "Test" Bhogadi', headline: 'Oracle DBA', location: 'Mississauga', total_experience_years: 4, summary: 'DBA' };
const resume = { version: 2, filename: 'resume.txt', extracted_text: 'Oracle RAC experience. '.repeat(200), parsed: JSON.stringify({ skills: ['Oracle RAC'] }) };

describe('buildSkillMd safety', () => {
  it('escapes quotes in YAML frontmatter instead of breaking it', () => {
    const { content } = natively.buildSkillMd(app(), candidate, resume, []);
    const frontmatter = content.split('---')[1];
    expect(frontmatter).toContain('Acme \\"Quoted\\" Corp');
    expect(frontmatter).not.toMatch(/\nname: interview-.*".*"\n/);
    // Frontmatter must still parse as two key: value lines.
    expect(frontmatter.trim().split('\n').length).toBe(2);
  });

  it('labels excerpts and reports omitted chars instead of truncating silently', () => {
    const { content, truncated, omittedChars } = natively.buildSkillMd(app(), candidate, resume, [], { contextChars: 1000 });
    expect(truncated).toBe(true);
    expect(omittedChars).toBeGreaterThan(0);
    expect(content).toContain('EXCERPTED CONTENT');
    expect(content).toContain(`${omittedChars} omitted`);
    expect(content).not.toContain('Complete documents included');
  });

  it('states completeness only when nothing was omitted', () => {
    const shortApp = app({ jd_text: 'Short JD: Oracle RAC required.' });
    const shortResume = { ...resume, extracted_text: 'Short resume: Oracle RAC.' };
    const { content, truncated, omittedChars } = natively.buildSkillMd(shortApp, candidate, shortResume, []);
    expect(truncated).toBe(false);
    expect(omittedChars).toBe(0);
    expect(content).toContain('Complete documents included');
  });

  it('refuses to build without a job description', () => {
    expect(() => natively.buildSkillMd(app({ jd_text: '   ' }), candidate, resume, [])).toThrow(/job description/i);
  });

  it('keeps candidate facts and employer requirements in separate sections', () => {
    const { content } = natively.buildSkillMd(app(), candidate, resume, []);
    const factsAt = content.indexOf('## Candidate facts');
    const jdAt = content.indexOf('## Job description');
    expect(factsAt).toBeGreaterThan(-1);
    expect(jdAt).toBeGreaterThan(factsAt);
    expect(content.slice(jdAt, jdAt + 200)).toMatch(/NOT candidate evidence/);
  });

  it('jdHash changes when the JD changes and is stable otherwise', () => {
    const a = natively.jdHashFor(app());
    const b = natively.jdHashFor(app());
    const c = natively.jdHashFor(app({ jd_text: 'different' }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('isSyncOutdated flags resume-version and JD changes', () => {
    const sync = { status: 'file_written', resume_version: 2, jd_hash: natively.jdHashFor(app()) };
    expect(natively.isSyncOutdated(sync, app(), resume)).toBe(false);
    expect(natively.isSyncOutdated(sync, app(), { ...resume, version: 3 })).toBe(true);
    expect(natively.isSyncOutdated(sync, app({ jd_text: 'changed JD' }), resume)).toBe(true);
    expect(natively.isSyncOutdated({ status: 'outdated', resume_version: 2, jd_hash: natively.jdHashFor(app()) }, app(), resume)).toBe(true);
  });
});
