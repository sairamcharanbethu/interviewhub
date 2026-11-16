import { describe, expect, it } from 'vitest';
import { computeMatch } from '@/lib/match';
import { HARRIS_JD, NAGA_RESUME } from '../fixtures';

describe('computeMatch — deterministic heuristic', () => {
  it('scores a strong Oracle DBA resume highly against the Harris JD', () => {
    const parsed = { skills: ['Oracle', 'Oracle RAC', 'Oracle Data Guard', 'PL/SQL', 'SQL', 'RMAN', 'Linux', 'AWS'], total_experience_years: 4, certifications: ['Oracle Certified Associate (OCA) — Oracle Database 19c'] };
    const r = computeMatch(NAGA_RESUME, parsed, HARRIS_JD, null);
    expect(r.score).toBeGreaterThanOrEqual(60);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.method).toContain('deterministic-local-heuristic');
    expect(r.summary.skills_total).toBeGreaterThan(0);
    expect(r.summary.skills_matched).toBeGreaterThan(0);
  });

  it('marks a demonstrated skill with resume evidence, not a bare boolean', () => {
    const parsed = { skills: ['Oracle RAC'], total_experience_years: 4, certifications: [] };
    const r = computeMatch(NAGA_RESUME, parsed, HARRIS_JD, null);
    const rac = r.requirements.find((x) => x.requirement === 'Oracle RAC');
    expect(rac).toBeDefined();
    expect(rac!.demonstrated).toBe(true);
    expect(rac!.evidence).not.toBe('Not demonstrated');
    expect(rac!.evidence.toLowerCase()).toContain('rac');
  });

  it('marks a missing skill as "Not demonstrated" and never fabricates it', () => {
    const jd = 'Required: 5+ years of Kubernetes and Terraform experience. Must know Go.';
    const parsed = { skills: ['Oracle'], total_experience_years: 4, certifications: [] };
    const r = computeMatch('Oracle DBA with 4 years experience.', parsed, jd, null);
    const k8s = r.requirements.find((x) => x.requirement === 'Kubernetes');
    expect(k8s).toBeDefined();
    expect(k8s!.demonstrated).toBe(false);
    expect(k8s!.evidence).toBe('Not demonstrated');
    // No requirement may claim a skill that appears in neither resume nor JD.
    const haystack = JSON.stringify(r.requirements);
    expect(haystack).not.toContain('Terraform expert');
    expect(r.requirements.every((x) => ['Kubernetes', 'Terraform', 'Go', '5+ years experience'].includes(x.requirement))).toBe(true);
  });

  it('scores 50 with no requirements at all (empty JD)', () => {
    const r = computeMatch(NAGA_RESUME, { skills: ['Oracle'] }, '', null);
    expect(r.score).toBe(50);
    expect(r.requirements).toHaveLength(0);
  });

  it('flags an experience shortfall as not demonstrated', () => {
    const jd = 'Required: 10+ years of experience as an Oracle DBA.';
    const r = computeMatch(NAGA_RESUME, { skills: ['Oracle'], total_experience_years: 4, certifications: [] }, jd, null);
    const exp = r.requirements.find((x) => x.requirement.includes('years experience'));
    expect(exp).toBeDefined();
    expect(exp!.demonstrated).toBe(false);
    expect(exp!.evidence).toContain('4 years');
  });

  it('uses a stored jd_parsed payload instead of re-parsing', () => {
    const jdParsed = JSON.stringify({ required_skills: ['Oracle RAC'], preferred_skills: [], languages: [], frameworks: [], tools: [], cloud: [], responsibilities: [], experience_years: null, education: [], certifications: [], keywords: ['Oracle RAC'] });
    const r = computeMatch(NAGA_RESUME, { skills: [], total_experience_years: 4, certifications: [] }, 'unrelated text', jdParsed);
    expect(r.requirements.some((x) => x.requirement === 'Oracle RAC' && x.demonstrated)).toBe(true);
  });
});
