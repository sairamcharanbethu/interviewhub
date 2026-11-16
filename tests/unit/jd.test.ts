import { describe, expect, it } from 'vitest';
import { parseJD } from '@/lib/parse/jd';
import { HARRIS_JD } from '../fixtures';

describe('parseJD', () => {
  it('extracts required skills, languages, cloud, and experience from the Harris JD', () => {
    const jd = parseJD(HARRIS_JD);
    expect(jd.required_skills).toEqual(expect.arrayContaining(['Oracle RAC', 'Oracle Data Guard', 'RMAN']));
    expect(jd.languages).toEqual(expect.arrayContaining(['PL/SQL', 'SQL']));
    expect(jd.cloud).toEqual(expect.arrayContaining(['AWS', 'Oracle Cloud']));
    expect(jd.experience_years).toBe(3);
  });

  it('finds certifications and education', () => {
    const jd = parseJD(HARRIS_JD);
    expect(jd.certifications.some((c) => /Oracle Certified/i.test(c))).toBe(true);
    expect(jd.education.length).toBeGreaterThan(0);
    expect(jd.education[0]).toMatch(/Bachelor/i);
  });

  it('extracts responsibilities from the Responsibilities section', () => {
    const jd = parseJD(HARRIS_JD);
    expect(jd.responsibilities.length).toBeGreaterThan(0);
    expect(jd.responsibilities.join(' ').toLowerCase()).toContain('patching');
  });

  it('separates preferred skills from required ones', () => {
    const jd = parseJD(HARRIS_JD);
    expect(jd.preferred_skills).toEqual(expect.arrayContaining(['Exadata']));
  });

  it('handles an empty JD without crashing', () => {
    const jd = parseJD('');
    expect(jd.required_skills).toEqual([]);
    expect(jd.experience_years).toBeNull();
    expect(jd.keywords).toEqual([]);
  });

  it('parses "5+ years" experience variants', () => {
    expect(parseJD('Need 5+ years of experience with Oracle.').experience_years).toBe(5);
    expect(parseJD('Minimum 7 yrs experience required.').experience_years).toBe(7);
  });
});
