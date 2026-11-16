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
});
