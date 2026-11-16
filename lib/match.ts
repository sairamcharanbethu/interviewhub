import { parseJson } from './db';
import { parseJD } from './parse/jd';
import { chatForTask, isAiConfiguredFor, type ChatResult } from './ai/providers';
import { parseAiJson } from './ai/json';
import { SYSTEM_PROMPTS, labelAsData, stripPII, stripInjection } from './ai/prompts';
import type { RagChunk } from './rag';

// Deterministic local heuristic ONLY. TODO hook: AI refinement will plug in here
// (see lib/ai/providers.ts chat()) in a later phase — this function stays explainable.
export interface MatchEvidence { requirement: string; demonstrated: boolean; evidence: string }
export interface MatchResult { score: number; requirements: MatchEvidence[]; summary: { skills_matched: number; skills_total: number; experience_years: number | null; experience_required: number | null; certifications_matched: string[]; certifications_required: string[] }; method: string }

export function computeMatch(resumeText: string, parsedResume: Record<string, unknown> | null, jdText: string, jdParsedRaw: string | null): MatchResult {
  const jd = jdParsedRaw ? parseJson<ReturnType<typeof parseJD> | null>(jdParsedRaw, null) ?? parseJD(jdText || '') : parseJD(jdText || '');
  const resumeSkills = new Set<string>(((parsedResume?.skills as string[]) || []).map((s) => s.toLowerCase()));
  const hay = (resumeText || '').toLowerCase();
  const requirements: MatchEvidence[] = [];
  const reqSkills = [...new Set([...(jd.required_skills || []), ...(jd.keywords || [])])];
  for (const skill of reqSkills) {
    const demonstrated = resumeSkills.has(skill.toLowerCase()) || hay.includes(skill.toLowerCase());
    let evidence = 'Not demonstrated';
    if (demonstrated) {
      const idx = hay.indexOf(skill.toLowerCase());
      evidence = idx >= 0 ? resumeText.slice(Math.max(0, idx - 60), idx + 120).replace(/\s+/g, ' ').trim() : `Skill listed on resume: ${skill}`;
    }
    requirements.push({ requirement: skill, demonstrated, evidence });
  }
  // Experience requirement
  const expYears = (parsedResume as { total_experience_years?: number } | null)?.total_experience_years ?? null;
  // experience is read from candidate record by caller via parsedResume passthrough; fallback: null
  const expReq = jd.experience_years;
  if (expReq !== null && expReq !== undefined) {
    const ok = expYears !== null && expYears >= expReq;
    requirements.push({ requirement: `${expReq}+ years experience`, demonstrated: ok, evidence: ok ? `Resume shows ${expYears} years` : expYears === null ? 'Not demonstrated' : `Resume shows ${expYears} years (requires ${expReq})` });
  }
  for (const cert of jd.certifications || []) {
    const certs = ((parsedResume?.certifications as string[]) || []).map((c) => c.toLowerCase());
    const demonstrated = certs.some((c) => c.includes(cert.toLowerCase())) || hay.includes(cert.toLowerCase());
    requirements.push({ requirement: `Certification: ${cert}`, demonstrated, evidence: demonstrated ? `Certification found on resume: ${cert}` : 'Not demonstrated' });
  }
  const matched = requirements.filter((r) => r.demonstrated).length;
  const total = requirements.length;
  const skillScore = total ? (matched / total) * 100 : 50;
  // Blend: 80% requirement coverage, 20% resume richness (skills present)
  const richness = Math.min(20, ((parsedResume?.skills as string[])?.length || 0) * 2);
  const score = total ? Math.round(Math.min(100, skillScore * 0.8 + richness)) : 50;
  return {
    score,
    requirements,
    summary: {
      skills_matched: reqSkills.filter((s) => resumeSkills.has(s.toLowerCase()) || hay.includes(s.toLowerCase())).length,
      skills_total: reqSkills.length,
      experience_years: expYears,
      experience_required: expReq ?? null,
      certifications_matched: (jd.certifications || []).filter((c) => hay.includes(c.toLowerCase())),
      certifications_required: jd.certifications || [],
    },
    method: 'deterministic-local-heuristic-v1 (skill/keyword overlap vs JD, experience, certs; no AI)',
  };
}

export interface AiRefineOutcome {
  result: MatchResult;
  ai_refined: boolean;
  ai_usage?: { provider: string; model: string; tokens_in: number; tokens_out: number };
  ai_error?: string;
}

interface AiAssessment {
  requirement: string;
  demonstrated: boolean;
  evidence: string;
}

/**
 * AI refinement of a heuristic match. Only called when the caller asked for
 * it ({ai_refine: true}) AND a provider is configured for the 'match' task.
 *
 * Guardrails (never invent skills to raise scores):
 * - The AI only sees retrieved, candidate-scoped RAG chunks + parsed JD
 *   requirements (PII-redacted when settings say so), never another
 *   candidate's data, never raw un-sanitized resume/JD text.
 * - An AI claim of "demonstrated" is accepted ONLY if the requirement's
 *   keyword appears in the retrieved context (or the heuristic already
 *   demonstrated it). Un-grounded AI claims stay 'Not demonstrated'.
 * - AI "not demonstrated" never overrides heuristic evidence that exists.
 * - Malformed AI JSON / provider failure -> heuristic result untouched,
 *   ai_refined: false, ai_error recorded. Never crashes, never fabricates.
 */
export async function refineMatchWithAI(
  heuristic: MatchResult,
  opts: { resumeChunks: RagChunk[]; jdText: string; jdParsedRaw: string | null; redactPii: boolean },
): Promise<AiRefineOutcome> {
  if (!isAiConfiguredFor('match')) {
    return { result: heuristic, ai_refined: false, ai_error: 'No AI provider configured for matching' };
  }
  const contextText = opts.resumeChunks.map((c) => c.chunk_text).join('\n---\n');
  const jd = opts.jdParsedRaw ? parseJson<ReturnType<typeof parseJD> | null>(opts.jdParsedRaw, null) ?? parseJD(opts.jdText || '') : parseJD(opts.jdText || '');
  const requirements = heuristic.requirements.map((r) => r.requirement);
  const maybeRedact = (t: string) => (opts.redactPii ? stripPII(t) : t);
  const userPrompt = [
    labelAsData('resume-evidence', maybeRedact(contextText)),
    labelAsData('jd-requirements', maybeRedact(JSON.stringify({ required_skills: jd.required_skills, keywords: jd.keywords, certifications: jd.certifications, experience_years: jd.experience_years }, null, 2))),
    `Heuristic assessments (do not contradict grounded evidence):\n${heuristic.requirements.map((r) => `- ${stripInjection(r.requirement)}: ${r.demonstrated ? 'demonstrated' : 'not demonstrated'} — ${stripInjection(r.evidence)}`).join('\n')}`,
    `For EACH of these requirements, assess whether the resume evidence demonstrates it: ${JSON.stringify(requirements)}`,
    `Reply with JSON ONLY, no other text: {"assessments": [{"requirement": "<exact requirement string>", "demonstrated": true|false, "evidence": "<short quote or paraphrase drawn ONLY from the resume evidence above, or 'Not demonstrated'"}]}`,
    `Rules: only mark demonstrated when the resume evidence above actually shows it. Never invent a skill, metric, project, or employer. If the evidence does not show it, demonstrated=false and evidence='Not demonstrated'.`,
  ].join('\n\n');
  let chatResult: ChatResult;
  try {
    chatResult = await chatForTask('match', [
      { role: 'system', content: SYSTEM_PROMPTS.match },
      { role: 'user', content: userPrompt },
    ]);
  } catch (e) {
    return { result: heuristic, ai_refined: false, ai_error: `AI provider failed: ${e instanceof Error ? e.message : 'unknown error'}` };
  }
  const parsed = parseAiJson<{ assessments?: unknown }>(chatResult.text);
  const assessments = parsed && Array.isArray(parsed.assessments) ? parsed.assessments : null;
  if (!assessments) {
    return { result: heuristic, ai_refined: false, ai_error: 'AI returned malformed JSON — kept heuristic result' };
  }
  const contextHay = contextText.toLowerCase();
  const byReq = new Map<string, AiAssessment>();
  for (const a of assessments) {
    if (typeof a !== 'object' || a === null) continue;
    const rec = a as Record<string, unknown>;
    if (typeof rec.requirement !== 'string' || typeof rec.demonstrated !== 'boolean' || typeof rec.evidence !== 'string') continue;
    byReq.set(rec.requirement.toLowerCase(), { requirement: rec.requirement, demonstrated: rec.demonstrated, evidence: rec.evidence.slice(0, 300) });
  }
  const mergedRequirements: MatchEvidence[] = heuristic.requirements.map((h) => {
    const ai = byReq.get(h.requirement.toLowerCase());
    if (!ai) return h;
    // AI "not demonstrated" never overrides existing heuristic evidence.
    if (!ai.demonstrated) return h;
    // AI "demonstrated": accept only if grounded in retrieved context or
    // already demonstrated by the heuristic.
    if (h.demonstrated) return { ...h, evidence: ai.evidence && ai.evidence !== 'Not demonstrated' ? ai.evidence : h.evidence };
    const keyword = h.requirement.replace(/^(certification:\s*|\d+\+?\s*years?\s*experience)/i, '').trim().toLowerCase();
    const grounded = keyword.length >= 2 && contextHay.includes(keyword);
    if (!grounded) return { ...h, evidence: 'Not demonstrated (AI claim not grounded in resume evidence)' };
    return { requirement: h.requirement, demonstrated: true, evidence: ai.evidence };
  });
  const matched = mergedRequirements.filter((r) => r.demonstrated).length;
  const total = mergedRequirements.length;
  const skillScore = total ? (matched / total) * 100 : 50;
  // Keep the heuristic's richness component (score minus its coverage part),
  // so the AI can only move the score via grounded requirement changes.
  const heuristicMatched = heuristic.requirements.filter((r) => r.demonstrated).length;
  const heuristicTotal = Math.max(1, heuristic.requirements.length);
  const heuristicRichness = Math.max(0, heuristic.score - Math.round((heuristicMatched / heuristicTotal) * 100 * 0.8));
  const score = total ? Math.round(Math.min(100, skillScore * 0.8 + heuristicRichness)) : 50;
  return {
    result: {
      ...heuristic,
      score,
      requirements: mergedRequirements,
      summary: {
        ...heuristic.summary,
        skills_matched: mergedRequirements.filter((r) => r.demonstrated).length,
      },
      method: `${heuristic.method} + ai-refined (provider assessment, grounded-only)`,
    },
    ai_refined: true,
    ai_usage: { provider: 'routed', model: chatResult.model, tokens_in: chatResult.tokensIn, tokens_out: chatResult.tokensOut },
  };
}
