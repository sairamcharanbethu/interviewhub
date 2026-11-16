import { describe, expect, it } from 'vitest';
import { aiSettingsSchema, applicationSchema, candidateSchema, starStorySchema } from '@/lib/validation';
import { normalizeRoute, normalizeRoutingInput } from '@/lib/ai/routing';

describe('validation schemas', () => {
  it('rejects a candidate with an empty name', () => {
    expect(() => candidateSchema.parse({ name: '' })).toThrow();
    expect(() => candidateSchema.parse({})).toThrow();
  });

  it('rejects a bad email and an out-of-range experience value', () => {
    expect(() => candidateSchema.parse({ name: 'Naga', email: 'not-an-email' })).toThrow();
    expect(() => candidateSchema.parse({ name: 'Naga', total_experience_years: 200 })).toThrow();
    expect(() => candidateSchema.parse({ name: 'Naga', total_experience_years: -1 })).toThrow();
  });

  it('accepts a valid candidate with optional fields omitted', () => {
    const c = candidateSchema.parse({ name: 'Naga Iswarya Lakshmi Bhogadi', location: 'Mississauga' });
    expect(c.name).toContain('Naga');
  });

  it('rejects an application without candidate_id/company/title and with a bad job_url', () => {
    expect(() => applicationSchema.parse({ company: 'Harris' })).toThrow();
    expect(() => applicationSchema.parse({ candidate_id: 'cand_1', company: 'Harris', title: 'DBA', job_url: 'not-a-url' })).toThrow();
    expect(applicationSchema.parse({ candidate_id: 'cand_1', company: 'Harris', title: 'DBA', job_url: '' }).job_url).toBe('');
  });

  it('rejects a STAR story without a title', () => {
    expect(() => starStorySchema.parse({ candidate_id: 'cand_1' })).toThrow();
  });

  it('accepts both routing shapes in aiSettingsSchema', () => {
    const legacy = aiSettingsSchema.parse({ routing: { match: 'openrouter', questions: 'ollama' } });
    expect(legacy.routing).toEqual({ match: 'openrouter', questions: 'ollama' });
    const canonical = aiSettingsSchema.parse({ routing: { match: { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash' } } });
    expect(canonical.routing).toEqual({ match: { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash' } });
  });

  it('rejects an unknown provider in routing', () => {
    expect(() => aiSettingsSchema.parse({ routing: { match: 'anthropic' } })).toThrow();
    expect(() => aiSettingsSchema.parse({ routing: { match: { provider: 'anthropic', model: 'x' } } })).toThrow();
  });
});

describe('routing normalisation', () => {
  it('normalises a legacy provider string to {provider, model:""}', () => {
    expect(normalizeRoute('openrouter')).toEqual({ provider: 'openrouter', model: '' });
    expect(normalizeRoute('ollama')).toEqual({ provider: 'ollama', model: '' });
  });

  it('passes a canonical object through, defaulting a missing model to ""', () => {
    expect(normalizeRoute({ provider: 'openrouter', model: 'gpt-x' })).toEqual({ provider: 'openrouter', model: 'gpt-x' });
    expect(normalizeRoute({ provider: 'ollama' })).toEqual({ provider: 'ollama', model: '' });
  });

  it('drops unknown providers instead of storing them', () => {
    expect(normalizeRoute('anthropic')).toBeNull();
    expect(normalizeRoute({ provider: 'anthropic' })).toBeNull();
    expect(normalizeRoute(null)).toBeNull();
  });

  it('maps legacy UI task keys to canonical AiTask keys', () => {
    const out = normalizeRoutingInput({ matching: 'openrouter', star_answers: { provider: 'ollama', model: 'llama3.1' }, questions: 'ollama' });
    expect(out).toEqual({
      match: { provider: 'openrouter', model: '' },
      star: { provider: 'ollama', model: 'llama3.1' },
      questions: { provider: 'ollama', model: '' },
    });
  });
});
