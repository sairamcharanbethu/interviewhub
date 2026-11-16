import { describe, expect, it } from 'vitest';
import { draftAnswer, generateQuestions } from '@/lib/prep';
import { HARRIS_JD, NAGA_RESUME } from '../fixtures';

describe('prep template fallback (offline)', () => {
  it('generates questions across categories from JD keywords', () => {
    const qs = generateQuestions(HARRIS_JD, 'Harris Computer');
    expect(qs.length).toBeGreaterThanOrEqual(12);
    const cats = new Set(qs.map((q) => q.category));
    expect(cats.has('Technical')).toBe(true);
    expect(cats.has('Behavioral')).toBe(true);
    expect(cats.has('Company')).toBe(true);
    // JD keywords drive the technical questions; nothing is invented.
    expect(qs.some((q) => q.question.includes('Oracle RAC'))).toBe(true);
    expect(qs.some((q) => q.question.includes('Harris Computer'))).toBe(true);
    expect(qs.every((q) => q.question.length > 10 && q.source.length > 0)).toBe(true);
  });

  it('still generates a usable set with an empty JD', () => {
    const qs = generateQuestions('', 'Acme');
    expect(qs.length).toBeGreaterThanOrEqual(10);
  });

  it('draftAnswer says "Not demonstrated" with no evidence', () => {
    const d = draftAnswer('Tell me about a time you led a migration.', 'Behavioral', '', []);
    expect(d.answer).toContain('Not demonstrated');
    expect(d.evidence).toEqual([]);
    expect(d.gaps.length).toBeGreaterThan(0);
  });

  it('draftAnswer cites resume evidence and never invents metrics', () => {
    const d = draftAnswer('Tell me about a time you tuned a slow query.', 'Behavioral', NAGA_RESUME, []);
    expect(d.evidence.length).toBeGreaterThan(0);
    expect(d.answer).not.toContain('reduced costs by 90%');
  });
});
