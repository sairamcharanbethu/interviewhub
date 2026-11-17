// Role insight + prep package assembly for the automated Prepare job.
// AI refinement is ON by default in the job; the deterministic score stays
// the transparent fallback. Clamp rule: AI may never raise a score above
// the deterministic score without cited resume evidence — then at most
// deterministic+10, with the justification recorded.
import { z } from 'zod';
import { get, all, run, newId, now, parseJson } from '../db';
import { computeMatch, refineMatchWithAI, type MatchResult } from '../match';
import { retrieveContext, storeDocumentChunks, type RagChunk } from '../rag';
import { getAiSettings } from '../ai/providers';
import { completeJsonWithFallback } from '../ai/registry';
import { buildStructuredPrompt } from '../ai/structured';
import { sanitizeUntrusted, stripInjection } from '../ai/prompts';
import { generateQuestions, draftAnswer, generateQuestionsAI, draftAnswersAI, type PrepQuestion } from '../prep';
import { parseJD } from '../parse/jd';
import type { CandidateProfile, JobAnalysis } from '../ai/extract';
import type { CompanyDossier } from '../company';

export interface RoleRequirement {
  requirement: string;
  priority: 'mandatory' | 'preferred';
  evidence: string;
  classification: 'demonstrated' | 'partially_demonstrated' | 'not_demonstrated';
  evidenceSource: string;
  suggestedFraming: string;
}
export interface RoleInsight {
  overallScore: number;
  deterministicScore: number;
  technicalCoverage: number;
  experienceCoverage: number;
  certificationCoverage: number;
  strongestQualifications: string[];
  missingQualifications: string[];
  weaknesses: string[];
  transferableSkills: string[];
  prepRecommendations: string[];
  requirements: RoleRequirement[];
  origin: 'ai' | 'fallback';
  aiScoreJustification?: string;
}

const insightSchema = z.object({
  strongestQualifications: z.array(z.string()).default([]),
  missingQualifications: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  transferableSkills: z.array(z.string()).default([]),
  prepRecommendations: z.array(z.string()).default([]),
  requirementAssessments: z.array(z.object({
    requirement: z.string(),
    classification: z.enum(['demonstrated', 'partially_demonstrated', 'not_demonstrated']),
    suggestedFraming: z.string().default(''),
  })).default([]),
});

function coverage(reqs: RoleRequirement[], priority?: 'mandatory' | 'preferred'): number {
  const list = priority ? reqs.filter((r) => r.priority === priority) : reqs;
  if (!list.length) return 50;
  const score = list.reduce((s, r) => s + (r.classification === 'demonstrated' ? 1 : r.classification === 'partially_demonstrated' ? 0.5 : 0), 0);
  return Math.round((score / list.length) * 100);
}

export async function buildRoleInsight(
  resumeText: string,
  parsedResume: Record<string, unknown> | null,
  jdText: string,
  jdParsedRaw: string | null,
  chunks: RagChunk[],
): Promise<{ insight: RoleInsight; match: MatchResult; aiRefined: boolean }> {
  const heuristic = computeMatch(resumeText, parsedResume, jdText, jdParsedRaw);
  const jd = parseJD(jdText || '');
  const requirements: RoleRequirement[] = heuristic.requirements.map((r) => {
    const isMandatory = jd.required_skills.includes(r.requirement) || jd.keywords.includes(r.requirement);
    return {
      requirement: r.requirement,
      priority: isMandatory ? 'mandatory' as const : 'preferred' as const,
      evidence: r.evidence,
      classification: r.demonstrated ? 'demonstrated' as const : 'not_demonstrated' as const,
      evidenceSource: r.demonstrated ? 'resume' : 'none',
      suggestedFraming: r.demonstrated ? `Lead with the resume evidence for ${r.requirement}.` : `Be honest about the gap in ${r.requirement}; name transferable experience if any.`,
    };
  });
  // AI refinement (job always attempts it when a provider is available).
  let aiRefined = false;
  let aiJustification: string | undefined;
  let finalScore = heuristic.score;
  try {
    const refined = await refineMatchWithAI(heuristic, { resumeChunks: chunks, jdText, jdParsedRaw, redactPii: getAiSettings().redact_pii });
    if (refined.ai_refined) {
      aiRefined = true;
      const aiScore = refined.result.score;
      if (aiScore > heuristic.score) {
        // Clamp: allow at most deterministic+10 only when the AI's new
        // "demonstrated" claims are grounded in retrieved evidence.
        const groundedNew = refined.result.requirements.filter((r, i) => r.demonstrated && !heuristic.requirements[i]?.demonstrated && r.evidence !== 'Not demonstrated');
        if (groundedNew.length) {
          finalScore = Math.min(aiScore, heuristic.score + 10);
          aiJustification = `AI score ${aiScore} clamped to ${finalScore} (deterministic ${heuristic.score} +10 max); grounded new evidence: ${groundedNew.map((r) => r.requirement).join(', ')}`;
        } else {
          finalScore = heuristic.score;
          aiJustification = `AI score ${aiScore} rejected — no cited resume evidence for the increase; kept deterministic ${heuristic.score}`;
        }
      } else {
        finalScore = aiScore;
      }
      // Merge AI requirement classifications where grounded.
      for (const ar of refined.result.requirements) {
        const req = requirements.find((x) => x.requirement.toLowerCase() === ar.requirement.toLowerCase());
        if (req && ar.demonstrated && !req.evidence.includes('Not demonstrated')) {
          req.classification = 'demonstrated';
          req.evidence = ar.evidence;
          req.evidenceSource = 'resume (AI-refined, grounded)';
        }
      }
    }
  } catch { /* AI refine failure → deterministic stands */ }

  // AI narrative (strengths/gaps/recommendations) via registry; fallback = deterministic derivation.
  let narrative: z.infer<typeof insightSchema> | null = null;
  let origin: 'ai' | 'fallback' = 'fallback';
  try {
    const messages = buildStructuredPrompt({
      system: 'You assess a candidate against a job description. Only use the resume evidence provided. Never invent skills, metrics, or experience.',
      task: 'Assess strengths, gaps, weaknesses, transferable skills, and prep recommendations for this candidate against this JD. Reply with JSON only.',
      dataBlocks: [
        { label: 'resume-evidence', content: sanitizeUntrusted(chunks.map((c) => c.chunk_text).join('\n---\n').slice(0, 6000)) },
        { label: 'jd-requirements', content: sanitizeUntrusted(JSON.stringify({ required: jd.required_skills, preferred: jd.preferred_skills, certifications: jd.certifications, experience: jd.experience_years })) },
      ],
      schemaHint: JSON.stringify({ strongestQualifications: ['string'], missingQualifications: ['string'], weaknesses: ['string'], transferableSkills: ['string'], prepRecommendations: ['string'], requirementAssessments: [{ requirement: 'string', classification: 'demonstrated|partially_demonstrated|not_demonstrated', suggestedFraming: 'string' }] }),
    });
    const out = await completeJsonWithFallback(messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n'), insightSchema);
    if (out.origin === 'ai' && out.result) { narrative = out.result.data as z.infer<typeof insightSchema>; origin = 'ai'; }
  } catch { /* fallback below */ }

  const demonstrated = requirements.filter((r) => r.classification === 'demonstrated').map((r) => r.requirement);
  const missing = requirements.filter((r) => r.classification === 'not_demonstrated').map((r) => r.requirement);
  const insight: RoleInsight = {
    overallScore: finalScore,
    deterministicScore: heuristic.score,
    technicalCoverage: coverage(requirements),
    experienceCoverage: jd.experience_years !== null && jd.experience_years !== undefined
      ? ((parsedResume?.total_experience_years as number | null) ?? 0) >= jd.experience_years ? 100 : Math.round((((parsedResume?.total_experience_years as number | null) ?? 0) / jd.experience_years) * 100)
      : 50,
    certificationCoverage: jd.certifications.length
      ? Math.round((heuristic.summary.certifications_matched.length / jd.certifications.length) * 100)
      : 100,
    strongestQualifications: narrative?.strongestQualifications?.length ? narrative.strongestQualifications : demonstrated.slice(0, 5),
    missingQualifications: narrative?.missingQualifications?.length ? narrative.missingQualifications : missing.slice(0, 5),
    weaknesses: narrative?.weaknesses ?? missing.slice(0, 3).map((m) => `Limited evidence for ${m}`),
    transferableSkills: narrative?.transferableSkills ?? [],
    prepRecommendations: narrative?.prepRecommendations?.length ? narrative.prepRecommendations : missing.slice(0, 3).map((m) => `Prepare a truthful answer about ${m}: name the gap, note transferable experience, and what you are doing to close it.`),
    requirements,
    origin,
    aiScoreJustification: aiJustification,
  };
  return { insight, match: { ...heuristic, score: finalScore }, aiRefined };
}

// ---------------------------------------------------------------- Intro ----
export interface TailoredIntro {
  tellMeAboutYourself: string;
  professionalSummary: string;
  whyGoodFit: string;
  whyThisRole: string;
  strongestQualifications: string[];
  origin: 'ai' | 'fallback';
}

export function buildIntroFallback(profile: CandidateProfile, job: JobAnalysis, insight: RoleInsight): TailoredIntro {
  const name = profile.fullName || 'I';
  const headline = profile.headline || job.title || 'this role';
  const top = insight.strongestQualifications.slice(0, 3).join(', ') || 'my core skills';
  return {
    tellMeAboutYourself: `I'm ${name}, ${headline} with ${profile.totalYearsExperience ?? 'several'} years of experience. My strongest areas are ${top}. ${profile.summary || ''}`.trim(),
    professionalSummary: profile.summary || `${headline} with experience in ${top}.`,
    whyGoodFit: insight.strongestQualifications.length ? `My strongest match to this role is: ${insight.strongestQualifications.join('; ')}.` : 'My background aligns with the core requirements of this role.',
    whyThisRole: `This ${job.title || 'role'} at ${job.company || 'the company'} matches the direction I want to grow in, and the responsibilities line up with work I have done.`,
    strongestQualifications: insight.strongestQualifications,
    origin: 'fallback',
  };
}

// ------------------------------------------------------------ Prep package --
export interface PrepPackage {
  intro: TailoredIntro;
  questions: Array<{ category: string; question: string; source: string; origin: 'ai' | 'fallback' }>;
  answers: Array<{ question: string; category: string; answer: string; evidence: string[]; gaps: string[]; origin: 'ai' | 'fallback' }>;
  starDrafts: Array<{ title: string; situation: string; task: string; action: string; result: string; technologies: string[]; skills: string[] }>;
  studyGuide: Array<{ topic: string; priority: 'high' | 'medium' | 'low'; reason: string }>;
  insight: RoleInsight;
  originSummary: Record<string, 'ai' | 'fallback'>;
}

const ALLOWED_CATEGORIES = ['Introduction', 'Behavioral', 'Technical', 'System design', 'Database', 'Domain', 'Scenario', 'Problem solving', 'Leadership', 'Role-specific', 'Company'];

export async function buildPrepPackage(
  candidateId: string,
  applicationId: string,
  profile: CandidateProfile,
  job: JobAnalysis,
  resumeText: string,
  jdText: string,
  chunks: RagChunk[],
): Promise<PrepPackage> {
  const settings = getAiSettings();
  const parsedResume = get<{ parsed: string }>(`SELECT parsed FROM resumes WHERE candidate_id = ? AND is_active = 1 ORDER BY version DESC LIMIT 1`, candidateId);
  const parsed = parseJson<Record<string, unknown>>((parsedResume?.parsed as string) || null, {});
  const { insight } = await buildRoleInsight(resumeText, { ...parsed, total_experience_years: profile.totalYearsExperience }, jdText, null, chunks);

  // Questions: AI-first via registry-aware generator, template fallback.
  const qOutcome = await generateQuestionsAI(jdText, job.company || '', { chunks, redactPii: settings.redact_pii });
  let questions = qOutcome.data.map((q: PrepQuestion) => ({ ...q, origin: (qOutcome.fallback ? 'fallback' : 'ai') as 'ai' | 'fallback' }));
  // Ensure 20–30 questions across relevant categories: top up with templates.
  if (questions.length < 20) {
    const template = generateQuestions(jdText, job.company || '');
    const seen = new Set(questions.map((q) => q.question.toLowerCase()));
    for (const t of template) {
      if (questions.length >= 24) break;
      if (!seen.has(t.question.toLowerCase())) { questions.push({ ...t, origin: 'fallback' as const }); seen.add(t.question.toLowerCase()); }
    }
  }
  questions = questions.slice(0, 30);

  // Answers: AI-first, template fallback per question.
  const aOutcome = await draftAnswersAI(
    questions.map((q) => ({ question: q.question, category: q.category })),
    { chunks, starStories: [], redactPii: settings.redact_pii },
  );
  const answers = aOutcome.data.map((a) => ({ ...a, origin: (aOutcome.fallback ? 'fallback' : 'ai') as 'ai' | 'fallback' }));

  // STAR drafts from resume evidence (unverified by construction).
  const starDrafts = buildStarDrafts(profile, resumeText, job);
  // Study guide prioritised by mandatory tech + gaps.
  const studyGuide = buildStudyGuide(job, insight);

  const intro = buildIntroFallback(profile, job, insight);
  const originSummary: Record<string, 'ai' | 'fallback'> = {
    role_insight: insight.origin,
    questions: qOutcome.fallback ? 'fallback' : 'ai',
    answers: aOutcome.fallback ? 'fallback' : 'ai',
    intro: 'fallback',
    star_drafts: 'fallback',
    study_guide: 'fallback',
  };
  return { intro, questions, answers, starDrafts, studyGuide, insight, originSummary };
}

function buildStarDrafts(profile: CandidateProfile, resumeText: string, job: JobAnalysis): PrepPackage['starDrafts'] {
  const drafts: PrepPackage['starDrafts'] = [];
  for (const emp of profile.employment.slice(0, 3)) {
    const achievements = emp.achievements.length ? emp.achievements.join(' ') : '';
    const responsibilities = emp.responsibilities.slice(0, 3).join(' ');
    drafts.push({
      title: `${emp.position || 'Role'} at ${emp.employer || 'employer'} — ${job.title || 'role'} relevance`,
      situation: `${emp.position || 'Role'} at ${emp.employer || 'employer'}${emp.startDate ? ` (${emp.startDate} – ${emp.endDate || 'present'})` : ''}. ${responsibilities || 'See resume evidence.'}`,
      task: responsibilities || 'Not demonstrated',
      action: achievements || responsibilities || 'Not demonstrated',
      result: achievements || 'Not demonstrated',
      technologies: profile.skills.technical.slice(0, 5),
      skills: profile.skills.technical.slice(0, 5),
    });
  }
  if (!drafts.length && resumeText.trim()) {
    drafts.push({
      title: 'Resume-based STAR draft',
      situation: resumeText.slice(0, 300).replace(/\s+/g, ' ').trim(),
      task: 'Not demonstrated',
      action: 'Not demonstrated',
      result: 'Not demonstrated',
      technologies: profile.skills.technical.slice(0, 5),
      skills: profile.skills.technical.slice(0, 5),
    });
  }
  return drafts.slice(0, 5);
}

function buildStudyGuide(job: JobAnalysis, insight: RoleInsight): PrepPackage['studyGuide'] {
  const guide: PrepPackage['studyGuide'] = [];
  for (const skill of job.mandatorySkills.slice(0, 8)) {
    const req = insight.requirements.find((r) => r.requirement.toLowerCase() === skill.toLowerCase());
    guide.push({
      topic: skill,
      priority: req?.classification === 'demonstrated' ? 'medium' : 'high',
      reason: req?.classification === 'demonstrated' ? `Mandatory for this role — refresh depth so you can speak to it with examples.` : `Mandatory for this role and a gap in your evidence — study the concept and prepare a truthful framing.`,
    });
  }
  for (const gap of insight.missingQualifications.slice(0, 3)) {
    if (!guide.some((g) => g.topic.toLowerCase() === gap.toLowerCase())) {
      guide.push({ topic: gap, priority: 'high', reason: 'Identified gap — prepare a truthful professional response, never pretend experience.' });
    }
  }
  return guide.slice(0, 12);
}

/** Persist prep package artefacts: interview session + STAR drafts (verified=false).
 * Idempotent per application: a retry never creates a second session or a
 * second set of STAR drafts for the same application. */
export function persistPrepPackage(candidateId: string, applicationId: string, pkg: PrepPackage): { sessionId: string; starIds: string[] } {
  const existing = get<{ id: string }>(`SELECT id FROM interview_sessions WHERE application_id = ? ORDER BY created_at ASC LIMIT 1`, applicationId);
  if (existing) {
    const starIds = all<{ id: string }>(`SELECT id FROM star_stories WHERE candidate_id = ? AND title LIKE '% — % relevance' ORDER BY created_at ASC`, candidateId).map((r) => r.id);
    return { sessionId: existing.id, starIds };
  }
  const ts = now();
  const sessionId = newId('sess_');
  run(
    `INSERT INTO interview_sessions (id, application_id, candidate_id, title, questions, answers, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sessionId, applicationId, candidateId,
    `Prep: ${pkg.intro.whyThisRole.slice(0, 120)}`,
    JSON.stringify(pkg.questions.map((q) => ({ category: q.category, question: q.question, source: q.source, origin: q.origin }))),
    JSON.stringify(pkg.answers.map((a) => ({ question: a.question, category: a.category, answer: a.answer, evidence: a.evidence, gaps: a.gaps, origin: a.origin }))),
    JSON.stringify({ intro: pkg.intro, studyGuide: pkg.studyGuide, insight: pkg.insight, originSummary: pkg.originSummary }),
    ts, ts,
  );
  const starIds: string[] = [];
  for (const d of pkg.starDrafts) {
    const id = newId('star_');
    run(
      `INSERT INTO star_stories (id, candidate_id, title, situation, task, action, result, technologies, skills, employer, project, verification_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      id, candidateId, d.title, d.situation, d.task, d.action, d.result,
      JSON.stringify(d.technologies), JSON.stringify(d.skills), null, null, ts, ts,
    );
    starIds.push(id);
  }
  return { sessionId, starIds };
}

// ------------------------------------------------- Skill extra sections ----
export function buildPrepSkillSections(
  pkg: PrepPackage,
  dossier: import('../company').CompanyDossier | null,
  omittedSections: string[],
): { text: string; omittedSections: string[] } {
  const sections: Array<{ title: string; body: string; priority: number }> = [];
  const intro = pkg.intro;
  sections.push({ title: 'Tailored introduction', priority: 1, body: [
    `**Tell me about yourself:** ${intro.tellMeAboutYourself}`,
    `**Professional summary:** ${intro.professionalSummary}`,
    `**Why a good fit:** ${intro.whyGoodFit}`,
    `**Why this role:** ${intro.whyThisRole}`,
    `**Strongest qualifications:** ${intro.strongestQualifications.join('; ') || 'See evidence matrix.'}`,
    `_Origin: ${intro.origin === 'ai' ? 'Generated with AI' : 'Template fallback — AI unavailable'}_`,
  ].join('\n') });
  sections.push({ title: 'Evidence matrix (role insight)', priority: 2, body: [
    `Overall match: ${pkg.insight.overallScore}/100 (deterministic ${pkg.insight.deterministicScore}/100; origin: ${pkg.insight.origin === 'ai' ? 'AI-refined' : 'deterministic fallback'}). Technical coverage ${pkg.insight.technicalCoverage}%, experience ${pkg.insight.experienceCoverage}%, certifications ${pkg.insight.certificationCoverage}%.`,
    ...pkg.insight.requirements.map((r) => `- [${r.classification}] (${r.priority}) ${r.requirement} — ${r.evidence} | Framing: ${r.suggestedFraming}`),
  ].join('\n') });
  sections.push({ title: 'Strengths and gaps', priority: 3, body: [
    `**Strongest:** ${pkg.insight.strongestQualifications.join('; ') || '—'}`,
    `**Missing:** ${pkg.insight.missingQualifications.join('; ') || '—'}`,
    `**Weaknesses:** ${pkg.insight.weaknesses.join('; ') || '—'}`,
    `**Transferable skills:** ${pkg.insight.transferableSkills.join('; ') || '—'}`,
    `**Prep recommendations:** ${pkg.insight.prepRecommendations.join('; ') || '—'}`,
  ].join('\n') });
  sections.push({ title: 'Likely questions', priority: 4, body: pkg.questions.map((q, i) => `${i + 1}. [${q.category}] ${q.question} _(origin: ${q.origin})_`).join('\n') });
  sections.push({ title: 'Suggested answers + evidence', priority: 5, body: pkg.answers.map((a) => `### ${a.question}\n${a.answer}\n_Evidence: ${a.evidence.join(' | ') || 'None'}_ _Gaps: ${a.gaps.join('; ') || 'None'}_ _(origin: ${a.origin})_`).join('\n\n') });
  sections.push({ title: 'STAR bank (drafts — unverified)', priority: 6, body: pkg.starDrafts.map((s) => `### ${s.title}\n- Situation: ${s.situation}\n- Task: ${s.task}\n- Action: ${s.action}\n- Result: ${s.result}\n- Verification: draft (unverified — user must approve)`).join('\n\n') || 'No STAR drafts.' });
  sections.push({ title: 'Study guidance', priority: 7, body: pkg.studyGuide.map((g) => `- [${g.priority}] ${g.topic} — ${g.reason}`).join('\n') || 'No study topics.' });
  sections.push({ title: 'Company preparation', priority: 8, body: dossier?.available
    ? [`**${dossier.company}** (researched ${dossier.researchedAt}${dossier.fromCache ? ', from 7-day cache' : ''})`, dossier.overview, `Products/services: ${dossier.productsServices.join('; ') || '—'}`, `Sources:`, ...dossier.sources.map((s) => `- ${s.title} — ${s.url}`)].join('\n')
    : `Company research was unavailable (${dossier?.error || 'not run'}). Research the company in Natively before the interview: official site, careers/about pages, recent press releases — record source URLs and dates.` });
  sections.push({ title: 'Unsupported-question handling', priority: 9, body: 'If asked about something with no resume evidence, say so plainly ("I have not done that directly — here is the closest transferable experience…") and never invent results or numbers.' });
  sections.push({ title: 'Natural conversational delivery', priority: 10, body: 'Answer in the first person, conversationally. 30 seconds for introductions, 60 seconds for standard answers, 90 seconds for detailed walkthroughs. STAR for behavioral questions. Depth only where the resume shows hands-on experience; label theoretical knowledge as theoretical.' });
  // Sections are appended highest-priority first; truncation (in the caller)
  // drops the lowest-priority sections first and records them honestly.
  sections.sort((a, b) => a.priority - b.priority);
  const text = sections.map((s) => `\n## ${s.title}\n${s.body}`).join('\n');
  return { text, omittedSections };
}

export { stripInjection, ALLOWED_CATEGORIES };
