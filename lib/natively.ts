import fs from 'fs';
import path from 'path';
import { get, all, parseJson } from './db';
import { skillsDir } from './files';
import { guardPath, safeFilename } from './security';
import { slug } from './serialize';

export function skillNameFor(candidateName: string, company: string, title: string): string {
  return `interview-${slug(candidateName)}-${slug(company)}-${slug(title)}`;
}

export function skillFileName(name: string): string {
  return `${safeFilename(name)}.md`;
}

export function buildSkillMd(app: Record<string, unknown>, candidate: Record<string, unknown>, resume: Record<string, unknown> | undefined, stories: Array<Record<string, unknown>>): string {
  const name = skillNameFor(String(candidate.name || 'candidate'), String(app.company || ''), String(app.title || ''));
  const resumeText = String(resume?.extracted_text || '').slice(0, 6000);
  const jdExcerpt = String(app.jd_text || '').slice(0, 4000);
  const parsed = parseJson<Record<string, unknown>>((resume?.parsed as string) || null, {});
  const skills = ((parsed.skills as string[]) || []).join(', ');
  const stars = stories.map((s) => `### ${s.title}\n- Situation: ${s.situation || ''}\n- Task: ${s.task || ''}\n- Action: ${s.action || ''}\n- Result: ${s.result || ''}\n- Technologies: ${(parseJson<string[]>(s.technologies as string, [])).join(', ')}\n- Verification: ${s.verification_status || 'draft'}`).join('\n\n') || 'No STAR stories on file.';
  return `---\nname: ${name}\ndescription: Interview preparation skill for ${candidate.name} — ${app.title} at ${app.company}. Use when preparing for, rehearsing, or debriefing this interview.\n---\n\n# Interview Prep: ${candidate.name} — ${app.title} at ${app.company}\n\n## Factual-accuracy rules (mandatory)\n- Never invent metrics, projects, employers, dates, or skills.\n- Cite only evidence from the resume, JD, and STAR stories below.\n- Anything not evidenced must be marked "Not demonstrated".\n- Do not hallucinate interview outcomes or offers.\n\n## Candidate summary\n- Name: ${candidate.name}\n- Headline: ${candidate.headline || ''}\n- Location: ${candidate.location || ''}\n- Experience: ${candidate.total_experience_years ?? 'unknown'} years\n- Skills: ${skills}\n- Summary: ${candidate.summary || ''}\n\n## Resume excerpt (evidence only)\n${resumeText || 'No resume on file.'}\n\n## Job description excerpt\n${jdExcerpt || 'No JD on file.'}\n\n## STAR stories\n${stars}\n\n## Application notes\n${app.notes || ''}\n${app.company_notes ? `\nCompany notes: ${app.company_notes}` : ''}\n`;
}

export function writeSkillFile(name: string, content: string): string {
  if (!name.startsWith('interview-')) throw new Error('Only interview-* skills may be written');
  const dir = skillsDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = guardPath(dir, skillFileName(name));
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
  return file;
}

export function readSkillFile(name: string): string | null {
  if (!name.startsWith('interview-')) return null;
  const file = guardPath(skillsDir(), skillFileName(name));
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

export function listInterviewSkills(): Array<{ name: string; path: string }> {
  const dir = skillsDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.startsWith('interview-') && f.endsWith('.md')).map((f) => ({ name: f.replace(/\.md$/, ''), path: path.join(dir, f) }));
}

export function loadApplicationContext(applicationId: string) {
  const app = get<Record<string, unknown>>(`SELECT * FROM applications WHERE id = ? AND deleted_at IS NULL`, applicationId);
  if (!app) return null;
  const candidate = get<Record<string, unknown>>(`SELECT * FROM candidates WHERE id = ?`, app.candidate_id);
  const resume = get<Record<string, unknown>>(`SELECT * FROM resumes WHERE candidate_id = ? AND is_active = 1 ORDER BY version DESC LIMIT 1`, app.candidate_id);
  const stories = all<Record<string, unknown>>(`SELECT * FROM star_stories WHERE candidate_id = ? AND archived_at IS NULL ORDER BY created_at DESC`, app.candidate_id);
  return { app, candidate: candidate!, resume, stories };
}
