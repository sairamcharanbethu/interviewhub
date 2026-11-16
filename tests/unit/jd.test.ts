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

  it('infers company, title, location and type from the Harris JD', () => {
    const jd = parseJD(HARRIS_JD);
    expect(jd.company).toBe('Harris Computer');
    expect(jd.title).toBe('Technical Consultant – Oracle DBA');
    expect(jd.location).toContain('Remote');
    expect(jd.employment_type).toBe('Remote');
  });

  it('infers fields from explicit labels', () => {
    const jd = parseJD('Job Title: Senior Oracle DBA\nCompany: Acme Corp\nLocation: Toronto, ON\nFull-time\n\nRequired: Oracle RAC, RMAN, PL/SQL. 5+ years of experience.');
    expect(jd.company).toBe('Acme Corp');
    expect(jd.title).toBe('Senior Oracle DBA');
    expect(jd.location).toBe('Toronto, ON');
    expect(jd.employment_type).toBe('Full-time');
  });

  it('infers title from a hiring sentence and company from an About line', () => {
    const jd = parseJD('About Acme Corp\nWe are hiring a Cloud DBA to join our team.\nRequired: AWS, Oracle, RMAN.');
    expect(jd.company).toBe('Acme Corp');
    expect(jd.title).toMatch(/Cloud DBA/);
  });

  it('infers company from a LinkedIn-style Company · Location line', () => {
    const jd = parseJD('Senior Oracle DBA\nAcme Corp · Toronto, ON\nWe need an Oracle DBA with RAC experience.');
    expect(jd.company).toBe('Acme Corp');
    expect(jd.location).toBe('Toronto, ON');
  });

  it('leaves inferred fields null when the posting does not state them', () => {
    const jd = parseJD('Some random text about databases and tuning.');
    expect(jd.company).toBeNull();
    expect(jd.title).toBeNull();
    expect(jd.location).toBeNull();
    expect(jd.employment_type).toBeNull();
    const empty = parseJD('');
    expect(empty.company).toBeNull();
    expect(empty.title).toBeNull();
  });
});
