import { z } from 'zod';
import { parseJD } from './parse/jd';
import { chatForTask, isAiConfiguredFor, AI_TIMEOUT_MS, type ChatResult } from './ai/providers';
import { completeJsonWithFallback } from './ai/registry';
import { parseAiJson, isObjectArray } from './ai/json';
import { SYSTEM_PROMPTS, labelAsData, stripPII, stripInjection } from './ai/prompts';
import type { RagChunk } from './rag';

export interface AiCallOutcome<T> {
  data: T;
  fallback: boolean;
  ai_error?: string;
  ai_usage?: { model: string; tokens_in: number; tokens_out: number };
}

const PREP_CATEGORIES: PrepCategory[] = ['Introduction', 'Behavioral', 'Technical', 'System design', 'Leadership', 'Problem solving', 'Scenario', 'Domain', 'Company', 'Role'];

function validCategory(c: unknown): c is PrepCategory {
  return typeof c === 'string' && (PREP_CATEGORIES as string[]).includes(c);
}

function contextBlock(chunks: RagChunk[], redactPii: boolean): string {
  const text = chunks.map((c) => c.chunk_text).join('\n---\n');
  return redactPii ? stripPII(text) : text;
}

/**
 * AI question generation. Uses the routed 'questions' provider with
 * candidate/application-scoped RAG context + parsed JD. On any failure
 * (no provider, timeout, malformed JSON) returns the template fallback
 * with fallback: true and an error note — never crashes, never invents.
 */
export async function generateQuestionsAI(
  jdText: string,
  company: string,
  opts: { chunks: RagChunk[]; redactPii: boolean },
): Promise<AiCallOutcome<PrepQuestion[]>> {
  const fallback = generateQuestions(jdText, company);
  // No provider gate here: the registry tries OpenRouter > Codex >
  // Antigravity > Ollama and returns the template fallback when none works.
  const jd = parseJD(jdText || '');
  const userPrompt = [
    labelAsData('resume-evidence', contextBlock(opts.chunks, opts.redactPii)),
    labelAsData('job-description', opts.redactPii ? stripPII(jdText) : jdText),
    `Company: ${stripInjection(company || 'this company')}. JD keywords: ${jd.keywords.slice(0, 10).join(', ') || 'none parsed'}.`,
    `Generate 12-16 interview questions covering these categories: ${PREP_CATEGORIES.join(', ')}. Base every question on the JD or the resume evidence above. Never invent experience for the candidate.`,
    `Reply with JSON ONLY, no other text: {"questions": [{"category": "<one of ${PREP_CATEGORIES.join(' | ')}>", "question": "<question text>", "source": "<JD keyword or resume evidence it is based on>"}]}`,
  ].join('\n\n');
  const qSchema = z.object({ questions: z.array(z.object({ category: z.string(), question: z.string(), source: z.string().optional() })) });
  const aiOut = await completeJsonWithFallback(`${SYSTEM_PROMPTS.questions}

${userPrompt}`, qSchema);
  if (aiOut.origin !== 'ai' || !aiOut.result) {
    return { data: fallback, fallback: true, ai_error: `AI provider failed: ${aiOut.attempts.map((a) => `${a.provider}: ${a.message}`).join('; ')}` };
  }
  const res: ChatResult = { text: '', model: aiOut.model || aiOut.providerId, tokensIn: 0, tokensOut: 0 };
  const parsed = aiOut.result.data as { questions?: unknown };
  if (!parsed || !isObjectArray(parsed.questions)) {
    return { data: fallback, fallback: true, ai_error: 'AI returned malformed JSON — used template fallback' };
  }
  const questions: PrepQuestion[] = [];
  for (const q of parsed.questions) {
    if (typeof q.question !== 'string' || !q.question.trim()) continue;
    if (!validCategory(q.category)) continue;
    questions.push({ category: q.category, question: stripInjection(q.question.trim()).slice(0, 500), source: typeof q.source === 'string' ? q.source.slice(0, 200) : 'AI generated' });
  }
  if (questions.length < 4) {
    return { data: fallback, fallback: true, ai_error: 'AI returned too few valid questions — used template fallback' };
  }
  return { data: questions, fallback: false, ai_usage: { model: res.model, tokens_in: res.tokensIn, tokens_out: res.tokensOut } };
}

export interface AiDraftedAnswer {
  question: string;
  category: string;
  answer: string;
  evidence: string[];
  gaps: string[];
}

/**
 * AI answer drafting. One provider call for the whole batch. Answers must
 * cite only verified resume/STAR evidence; anything un-evidenced is
 * 'Not demonstrated'. On failure, falls back to the template drafter
 * per question with fallback: true.
 */
export async function draftAnswersAI(
  questions: Array<{ question: string; category?: string }>,
  opts: { chunks: RagChunk[]; starStories: Array<Record<string, unknown>>; redactPii: boolean },
): Promise<AiCallOutcome<AiDraftedAnswer[]>> {
  const template = questions.map((q) => {
    const resumeText = opts.chunks.map((c) => c.chunk_text).join('\n');
    const d = draftAnswer(q.question, q.category || 'Behavioral', resumeText, opts.starStories);
    return { question: q.question, category: q.category || 'Behavioral', ...d };
  });
  // No provider gate here: the registry falls back to the template drafter.
  const starBlock = opts.starStories.slice(0, 5).map((s, i) =>
    `Story ${i + 1} (${String(s.title || 'Untitled')}): Situation: ${String(s.situation || '')} Task: ${String(s.task || '')} Action: ${String(s.action || '')} Result: ${String(s.result || '')}`).join('\n');
  const userPrompt = [
    labelAsData('resume-evidence', contextBlock(opts.chunks, opts.redactPii)),
    labelAsData('star-stories', opts.redactPii ? stripPII(starBlock) : starBlock),
    `Draft a first-person interview answer for EACH question below. Use STAR structure for Behavioral/Leadership questions. Cite ONLY the resume/STAR evidence above. If evidence is missing for a question, the answer must say 'Not demonstrated' and list it in gaps. Never invent metrics, projects, employers, or results.`,
    questions.map((q, i) => `${i + 1}. [${q.category || 'Behavioral'}] ${stripInjection(q.question)}`).join('\n'),
    `Reply with JSON ONLY, no other text: {"answers": [{"question": "<exact question text>", "answer": "<first-person STAR answer, or 'Not demonstrated ...'>", "evidence": ["<short quote from the evidence above>"], "gaps": ["<what is not demonstrated, if any>"]}]}`,
  ].join('\n\n');
  const aSchema = z.object({ answers: z.array(z.object({ question: z.string(), answer: z.string(), evidence: z.array(z.string()).optional(), gaps: z.array(z.string()).optional() })) });
  const aiOut = await completeJsonWithFallback(`${SYSTEM_PROMPTS.answers}

${userPrompt}`, aSchema);
  if (aiOut.origin !== 'ai' || !aiOut.result) {
    return { data: template, fallback: true, ai_error: `AI provider failed: ${aiOut.attempts.map((a) => `${a.provider}: ${a.message}`).join('; ')}` };
  }
  const res: ChatResult = { text: '', model: aiOut.model || aiOut.providerId, tokensIn: 0, tokensOut: 0 };
  const parsed = aiOut.result.data as { answers?: unknown };
  if (!parsed || !isObjectArray(parsed.answers)) {
    return { data: template, fallback: true, ai_error: 'AI returned malformed JSON — used template fallback' };
  }
  const byQuestion = new Map<string, Record<string, unknown>>();
  for (const a of parsed.answers) byQuestion.set(String(a.question || '').trim().toLowerCase(), a);
  const drafted: AiDraftedAnswer[] = questions.map((q, i) => {
    const ai = byQuestion.get(q.question.trim().toLowerCase());
    if (!ai || typeof ai.answer !== 'string' || !ai.answer.trim()) return template[i];
    const evidence = Array.isArray(ai.evidence) ? (ai.evidence as unknown[]).filter((e) => typeof e === 'string').map((e) => (e as string).slice(0, 400)) : template[i].evidence;
    const gaps = Array.isArray(ai.gaps) ? (ai.gaps as unknown[]).filter((g) => typeof g === 'string').map((g) => (g as string).slice(0, 300)) : template[i].gaps;
    return { question: q.question, category: q.category || 'Behavioral', answer: stripInjection(ai.answer.trim()).slice(0, 4000), evidence, gaps };
  });
  return { data: drafted, fallback: false, ai_usage: { model: res.model, tokens_in: res.tokensIn, tokens_out: res.tokensOut } };
}

export interface StarDraft {
  title: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  technologies: string[];
  skills: string[];
  verification_status: 'draft';
}

/**
 * AI STAR draft from the candidate's resume evidence only. Returns a draft
 * for user approval — the caller must NOT save it as verified.
 */
export async function generateStarDraftAI(
  opts: { chunks: RagChunk[]; roleHint: string; redactPii: boolean },
): Promise<AiCallOutcome<StarDraft | null>> {
  if (!isAiConfiguredFor('star')) {
    return { data: null, fallback: true, ai_error: 'No AI provider configured for STAR drafts' };
  }
  const userPrompt = [
    labelAsData('resume-evidence', contextBlock(opts.chunks, opts.redactPii)),
    `Role/theme hint from the user: ${stripInjection(opts.roleHint || 'general experience')}`,
    `Draft ONE STAR story for this candidate based ONLY on the resume evidence above, most relevant to the hint. Never invent metrics, projects, employers, or results — any STAR element without evidence must be 'Not demonstrated'.`,
    `Reply with JSON ONLY, no other text: {"title": "<short title>", "situation": "<...>", "task": "<...>", "action": "<...>", "result": "<... or 'Not demonstrated'>", "technologies": ["<only technologies named in the evidence>"], "skills": ["<only skills named in the evidence>"]}`,
  ].join('\n\n');
  let res: ChatResult;
  try {
    res = await chatForTask('star', [
      { role: 'system', content: SYSTEM_PROMPTS.star },
      { role: 'user', content: userPrompt },
    ], AI_TIMEOUT_MS);
  } catch (e) {
    return { data: null, fallback: true, ai_error: `AI provider failed: ${e instanceof Error ? e.message : 'unknown error'}` };
  }
  const parsed = parseAiJson<Record<string, unknown>>(res.text);
  if (!parsed || typeof parsed.title !== 'string' || !parsed.title.trim()) {
    return { data: null, fallback: true, ai_error: 'AI returned malformed JSON — no draft generated' };
  }
  const str = (v: unknown) => (typeof v === 'string' ? stripInjection(v).slice(0, 2000) : 'Not demonstrated');
  const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x) => typeof x === 'string').map((x) => (x as string).slice(0, 100)) : []);
  return {
    data: {
      title: str(parsed.title).slice(0, 300),
      situation: str(parsed.situation),
      task: str(parsed.task),
      action: str(parsed.action),
      result: str(parsed.result),
      technologies: arr(parsed.technologies),
      skills: arr(parsed.skills),
      verification_status: 'draft',
    },
    fallback: false,
    ai_usage: { model: res.model, tokens_in: res.tokensIn, tokens_out: res.tokensOut },
  };
}

// TEMPLATE-based offline fallback ONLY. Provider hook: a later subagent wires
// lib/ai/providers.ts chat() here; templates stay as the offline fallback.
export type PrepCategory = 'Introduction' | 'Behavioral' | 'Technical' | 'System design' | 'Leadership' | 'Problem solving' | 'Scenario' | 'Domain' | 'Company' | 'Role';

export interface PrepQuestion { category: PrepCategory; question: string; source: string }

const TEMPLATES: Record<PrepCategory, string[]> = {
  Introduction: ['Tell me about yourself and your background relevant to this role.', 'Walk me through your most recent role and why you are looking for your next opportunity.'],
  Behavioral: ['Tell me about a time you faced a difficult technical problem. What did you do? (STAR)', 'Describe a time you disagreed with a teammate or stakeholder. How did you resolve it? (STAR)', 'Tell me about a project you are most proud of and your specific contribution. (STAR)'],
  Technical: ['Explain how you would approach {skill} in a production environment.', 'What are the key trade-offs when using {skill}?'],
  'System design': ['Design a system that uses {skill} at scale. Walk through your architecture and trade-offs.', 'How would you ensure reliability and performance for a system built on {skill}?'],
  Leadership: ['Describe a time you led a project or mentored others. What was the outcome? (STAR)', 'How do you prioritise when multiple stakeholders need your help at once?'],
  'Problem solving': ['Walk me through how you debug a production issue you have never seen before.', 'Describe a time you had to learn a new technology quickly to unblock a project. (STAR)'],
  Scenario: ['You discover a critical issue the day before a release. What do you do?', 'A key dependency goes down in production. Walk me through your response.'],
  Domain: ['What trends in this domain matter most for this role, and how have you applied them?', 'How does your experience in this domain map to the responsibilities listed in the job description?'],
  Company: ['What do you know about {company} and why do you want to work here?', 'How would you contribute to {company} in your first 90 days?'],
  Role: ['Which part of this role excites you most, and which part is the biggest stretch for you?', 'How would you measure success in this role after six months?'],
};

export function generateQuestions(jdText: string, company: string): PrepQuestion[] {
  const jd = parseJD(jdText || '');
  const out: PrepQuestion[] = [];
  const push = (cat: PrepCategory, q: string, source: string) => out.push({ category: cat, question: q, source });
  for (const q of TEMPLATES.Introduction) push('Introduction', q, 'Template: Introduction');
  for (const q of TEMPLATES.Behavioral) push('Behavioral', q, 'Template: Behavioral (STAR)');
  const skills = jd.keywords.slice(0, 4);
  if (skills.length) {
    for (const s of skills) {
      push('Technical', TEMPLATES.Technical[0].replace('{skill}', s), `JD keyword: ${s}`);
      push('System design', TEMPLATES['System design'][0].replace('{skill}', s), `JD keyword: ${s}`);
    }
  } else {
    push('Technical', 'Walk me through the core technologies you use day to day and why you chose them.', 'Template: Technical');
  }
  for (const q of TEMPLATES.Leadership) push('Leadership', q, 'Template: Leadership');
  for (const q of TEMPLATES['Problem solving']) push('Problem solving', q, 'Template: Problem solving');
  for (const q of TEMPLATES.Scenario) push('Scenario', q, 'Template: Scenario');
  for (const q of TEMPLATES.Domain) push('Domain', q, 'Template: Domain');
  for (const q of TEMPLATES.Company) push('Company', q.replace('{company}', company || 'this company'), 'Template: Company');
  for (const q of TEMPLATES.Role) push('Role', q, 'Template: Role');
  return out;
}

export function draftAnswer(question: string, category: string, resumeText: string, starStories: Array<Record<string, unknown>>): { answer: string; evidence: string[]; gaps: string[] } {
  // Cite only parsed resume evidence; never invent metrics/projects.
  const evidence: string[] = [];
  if (resumeText) {
    const snippet = resumeText.slice(0, 400).replace(/\s+/g, ' ').trim();
    if (snippet) evidence.push(snippet);
  }
  for (const s of starStories.slice(0, 2)) {
    const parts = [s.situation, s.task, s.action, s.result].filter(Boolean).join(' ');
    if (parts) evidence.push(String(parts).slice(0, 400));
  }
  const isBehavioral = category === 'Behavioral' || category === 'Leadership';
  if (!evidence.length) {
    return { answer: 'Not demonstrated — no matching evidence on the resume or in STAR stories for this question.', evidence: [], gaps: ['No resume/STAR evidence found for this question'] };
  }
  const star = isBehavioral
    ? `Situation: ${String(starStories[0]?.situation || 'See resume evidence below.')}\nTask: ${String(starStories[0]?.task || '')}\nAction: ${String(starStories[0]?.action || '')}\nResult: ${String(starStories[0]?.result || 'Not demonstrated')}`
    : `Based only on my resume evidence: ${evidence[0]}`;
  return {
    answer: `${star}\n\nQuestion: ${question}\n\nNote: drafted from resume/STAR evidence only — verify every claim against the resume before using it in an interview.`,
    evidence,
    gaps: evidence.length < 2 ? ['Limited evidence on file — add STAR stories to strengthen this answer'] : [],
  };
}
