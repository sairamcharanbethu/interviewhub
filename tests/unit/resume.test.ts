import { describe, expect, it } from 'vitest';
import { parseResume } from '@/lib/parse/resume';
import { NAGA_RESUME } from '../fixtures';

describe('parseResume', () => {
  it('extracts skills, employment, education, and certifications', () => {
    const r = parseResume(NAGA_RESUME);
    expect(r.skills).toEqual(expect.arrayContaining(['Oracle RAC', 'Oracle Data Guard', 'RMAN', 'PL/SQL', 'AWS', 'Python']));
    expect(r.employment.length).toBeGreaterThanOrEqual(1);
    expect(r.employment[0].raw).toContain('DXC Technology');
    expect(r.employment[0].dates).toMatch(/2022-06/);
    expect(r.education.length).toBeGreaterThanOrEqual(1);
    expect(r.education[0].raw).toMatch(/B\.Tech/);
    expect(r.certifications.some((c) => /Oracle Certified Associate/i.test(c))).toBe(true);
  });

  it('extracts contact details', () => {
    const r = parseResume(NAGA_RESUME);
    expect(r.emails).toContain('naga.bhogadi@example.com');
    expect(r.phones.length).toBeGreaterThanOrEqual(1);
  });

  it('gives a high extraction-quality score to a complete resume', () => {
    const r = parseResume(NAGA_RESUME);
    expect(r.extraction_quality).toBeGreaterThanOrEqual(80);
    expect(r.extraction_quality).toBeLessThanOrEqual(100);
  });

  it('gives a low quality score to near-empty text', () => {
    const r = parseResume('Hi');
    expect(r.extraction_quality).toBeLessThan(30);
    expect(r.skills).toEqual([]);
    expect(r.employment).toEqual([]);
  });

  it('does not invent skills that are not in the text', () => {
    const r = parseResume('Jane Doe. B.Tech. Worked at Acme 2020-2022 as a clerk.');
    expect(r.skills).not.toContain('Kubernetes');
    expect(r.skills).not.toContain('Oracle RAC');
  });

  it('extracts name, location, headline, summary and experience from the Naga resume', () => {
    const r = parseResume(NAGA_RESUME);
    expect(r.name).toBe('Naga Iswarya Lakshmi Bhogadi');
    expect(r.location).toContain('Mississauga');
    expect(r.headline).toMatch(/Oracle DBA/i);
    expect(r.summary).toMatch(/^Oracle Database Administrator with 4 years/);
    expect(r.total_experience_years).not.toBeNull();
    expect(r.total_experience_years as number).toBeGreaterThanOrEqual(3.5);
    expect(r.total_experience_years as number).toBeLessThanOrEqual(4.5);
    expect(r.employment[0].employer).toBe('DXC Technology');
    expect(r.employment[0].title).toBe('Software Engineer');
    expect(r.education[0].institution).toMatch(/NRI Institute of Technology/);
    expect(r.education[0].degree).toMatch(/B\.Tech/);
    expect(r.certifications.some((c) => /AWS Certified Solutions Architect/i.test(c))).toBe(true);
  });

  it('splits employer and title on dash/pipe separators', () => {
    const a = parseResume('Alex Kumar\nOracle DBA\nToronto, ON\n\nEMPLOYMENT\nOracle DBA — DXC Technology — 2020-01 to 2023-06');
    expect(a.employment[0].title).toBe('Oracle DBA');
    expect(a.employment[0].employer).toBe('DXC Technology');
    const b = parseResume('Alex Kumar\nOracle DBA\nToronto, ON\n\nEMPLOYMENT\nDXC Technology | Oracle DBA | 2020-01 to 2023-06');
    expect(b.employment[0].title).toBe('Oracle DBA');
    expect(b.employment[0].employer).toBe('DXC Technology');
  });

  it('takes the title from the line above an employer+dates line', () => {
    const r = parseResume('Alex Kumar\nOracle DBA\nToronto, ON\n\nEMPLOYMENT\nOracle DBA\nDXC Technology, Mississauga — 2020-01 to 2023-06');
    expect(r.employment[0].title).toBe('Oracle DBA');
    expect(r.employment[0].employer).toBe('DXC Technology');
  });

  it('leaves name/location/headline/experience blank when the text does not state them', () => {
    const r = parseResume('Worked with databases for a while. Likes SQL.');
    expect(r.name).toBeNull();
    expect(r.location).toBeNull();
    expect(r.headline).toBeNull();
    expect(r.summary).toBeNull();
    expect(r.total_experience_years).toBeNull();
    expect(r.emails).toEqual([]);
  });
});
