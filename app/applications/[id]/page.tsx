'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { useApp } from '@/components/context';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, ScoreBar, Select, Spinner, Textarea } from '@/components/ui';
import ApplicationForm, { type ApplicationFormData } from '@/components/ApplicationForm';
import type { Application, Candidate, InterviewSession, MatchResult, PrepAnswer, PrepQuestion, Resume, SkillSync } from '@/lib/types';
import { errMsg, fmtDateTime } from '@/lib/types';

/** SkillSync row plus the remediation lifecycle fields (migration 002). */
type SyncRow = SkillSync & {
  resume_version?: number | null;
  jd_hash?: string | null;
  content_hash?: string | null;
  version_number?: number | null;
};

const NATIVELY_STATUS_TONE: Record<string, 'green' | 'blue' | 'amber' | 'red' | 'gray'> = {
  file_written: 'blue',
  awaiting_import: 'amber',
  imported: 'green',
  activation_verified: 'green',
  outdated: 'red',
  failed: 'red',
  generated: 'gray',
  not_generated: 'gray',
};

const NATIVELY_IMPORT_STEPS = [
  'Open Natively.',
  'Navigate to Skills.',
  'Add or point Natively to the generated interview Skill file.',
  'Select the generated interview-*.md file.',
  'Confirm that the Skill appears in Natively’s Skills list.',
  'Activate the Skill.',
  'Test it with an interview question.',
];

export default function ApplicationDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { toast, setApplicationId, setPrepInProgress } = useApp();
  const [app, setApp] = useState<Application | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [sessions, setSessions] = useState<InterviewSession[]>([]);
  const [syncs, setSyncs] = useState<SyncRow[]>([]);
  const [natOutdated, setNatOutdated] = useState(false);
  const [natOutputDir, setNatOutputDir] = useState('');
  const [preview, setPreview] = useState<{ skill_name: string; content: string; truncated: boolean; omitted_chars: number } | null>(null);
  const [versions, setVersions] = useState<Array<{ version_number: number; created_at: string; content_chars: number }>>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // JD
  const [jdText, setJdText] = useState('');
  const [jdUrl, setJdUrl] = useState('');
  const [jdError, setJdError] = useState('');
  const [jdBusy, setJdBusy] = useState(false);
  // Match
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [matchBusy, setMatchBusy] = useState(false);
  const [matchError, setMatchError] = useState('');
  // Prep
  const [questions, setQuestions] = useState<PrepQuestion[]>([]);
  const [answers, setAnswers] = useState<PrepAnswer[]>([]);
  const [qBusy, setQBusy] = useState(false);
  const [aBusy, setABusy] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  // Natively
  const [natBusy, setNatBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const a = await apiGet<{ application: Application }>(`/api/applications/${id}`);
      setApp(a.application); setJdText(a.application.jd_text || ''); setNotesDraft(a.application.notes || '');
      const [c, rs, ss, sy] = await Promise.all([
        apiGet<{ candidate: Candidate }>(`/api/candidates/${a.application.candidate_id}`),
        apiGet<{ resumes: Resume[] }>(`/api/candidates/${a.application.candidate_id}/resumes`),
        apiGet<{ interview_sessions: InterviewSession[] }>(`/api/interview-sessions?application_id=${encodeURIComponent(id)}`),
        apiGet<{ syncs: SyncRow[]; outdated: boolean; output_dir: string }>(`/api/natively/status?application_id=${encodeURIComponent(id)}`),
      ]);
      setCandidate(c.candidate); setResumes(rs.resumes); setSessions(ss.interview_sessions); setSyncs(sy.syncs);
      setNatOutdated(Boolean(sy.outdated)); setNatOutputDir(sy.output_dir || '');
      const all = await apiGet<{ candidates: Candidate[] }>('/api/candidates');
      setCandidates(all.candidates);
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setApplicationId(id); }, [id, setApplicationId]);

  const groupedQuestions = useMemo(() => {
    const m = new Map<string, PrepQuestion[]>();
    for (const q of questions) { const arr = m.get(q.category) || []; arr.push(q); m.set(q.category, arr); }
    return [...m.entries()];
  }, [questions]);

  const saveJd = async (payload: { jd_text?: string; job_url?: string } | FormData) => {
    setJdBusy(true); setJdError('');
    try {
      const isForm = payload instanceof FormData;
      const res = await fetch(`/api/applications/${id}/jd`, isForm ? { method: 'POST', body: payload } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `JD save failed (${res.status})`);
      const updated = (data as { application: Application }).application;
      setApp(updated); setJdText(updated.jd_text || '');
      toast('Job description saved and parsed');
    } catch (e) { setJdError(errMsg(e)); } finally { setJdBusy(false); }
  };
  const runMatch = async () => {
    setMatchBusy(true); setMatchError('');
    try {
      const r = await apiPost<MatchResult>(`/api/applications/${id}/match`, {});
      setMatch(r); toast(`Match score ${r.score}%`);
    } catch (e) { setMatchError(errMsg(e)); } finally { setMatchBusy(false); }
  };
  const genQuestions = async () => {
    setQBusy(true); setPrepInProgress(true);
    try {
      const r = await apiPost<{ questions: PrepQuestion[] }>(`/api/applications/${id}/prep/questions`, {});
      setQuestions(r.questions); setAnswers([]);
      toast(`${r.questions.length} questions generated (template fallback)`);
    } catch (e) { toast(errMsg(e), 'err'); } finally { setQBusy(false); }
  };
  const genAnswers = async () => {
    if (!questions.length) return;
    setABusy(true);
    try {
      const r = await apiPost<{ answers: PrepAnswer[] }>(`/api/applications/${id}/prep/answers`, { questions: questions.map((q) => ({ question: q.question, category: q.category })) });
      setAnswers(r.answers); toast(`${r.answers.length} answers drafted from resume/STAR evidence only`);
    } catch (e) { toast(errMsg(e), 'err'); } finally { setABusy(false); }
  };
  const saveSession = async () => {
    if (!app || !candidate) return;
    try {
      await apiPost('/api/interview-sessions', {
        application_id: app.id, candidate_id: candidate.id,
        title: sessionTitle.trim() || `Prep — ${app.company} ${app.title}`,
        questions: questions.map((q) => ({ category: q.category, question: q.question })),
        answers: answers.map((a) => ({ question: a.question, category: a.category, answer: a.answer, evidence: a.evidence, gaps: a.gaps })),
        notes: sessionNotes.trim() || null,
      });
      toast('Interview session saved'); setPrepInProgress(false); await load();
    } catch (e) { toast(errMsg(e), 'err'); }
  };
  const saveNotes = async () => {
    setNotesSaving(true);
    try { const u = await apiPatch<{ application: Application }>(`/api/applications/${id}`, { notes: notesDraft }); setApp(u.application); toast('Notes saved'); }
    catch (e) { toast(errMsg(e), 'err'); } finally { setNotesSaving(false); }
  };
  const nativelyGenerate = async (confirmOverwrite = false) => {
    setNatBusy('gen');
    try {
      const res = await fetch('/api/natively/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ application_id: id, confirm_overwrite: confirmOverwrite }) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && (data as { needs_confirmation?: boolean }).needs_confirmation) { setConfirmRegen(true); return; }
      if (!res.ok) throw new Error((data as { error?: string }).error || `Generate failed (${res.status})`);
      const r = data as { skill_name: string; status: string; truncated?: boolean; omitted_chars?: number };
      toast(`Skill written: ${r.skill_name}${r.truncated ? ` — excerpts used, ${r.omitted_chars ?? 0} chars omitted (full text stays in InterviewHub)` : ''}`);
      setConfirmRegen(false); await load();
    } catch (e) { toast(errMsg(e), 'err'); } finally { setNatBusy(''); }
  };
  const nativelyPreview = async () => {
    setNatBusy('preview');
    try {
      const r = await apiPost<{ skill_name: string; content: string; truncated: boolean; omitted_chars: number }>('/api/natively/preview', { application_id: id });
      setPreview(r);
    } catch (e) { toast(errMsg(e), 'err'); } finally { setNatBusy(''); }
  };
  const nativelyConfirm = async (action: 'imported' | 'activated' | 'outdated' | 'awaiting_import') => {
    setNatBusy(`confirm-${action}`);
    try {
      const r = await apiPost<{ status: string }>('/api/natively/confirm', { application_id: id, action });
      toast(`Skill status: ${r.status}`); await load();
    } catch (e) { toast(errMsg(e), 'err'); } finally { setNatBusy(''); }
  };
  const nativelyCopyPath = async () => {
    const p = syncs[0]?.skill_path;
    if (!p) return;
    try { await navigator.clipboard.writeText(p); toast('File path copied'); }
    catch { toast(p, 'err'); }
  };
  const nativelyDelete = async () => {
    if (!window.confirm('Delete the generated Skill file and its version history? The application, candidate, and resumes are untouched.')) return;
    setNatBusy('del');
    try {
      const res = await fetch(`/api/natively/delete?application_id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Delete failed (${res.status})`);
      toast('Skill deleted'); await load();
    } catch (e) { toast(errMsg(e), 'err'); } finally { setNatBusy(''); }
  };
  const nativelyLoadVersions = async () => {
    try {
      const r = await apiGet<{ versions: Array<{ version_number: number; created_at: string; content_chars: number }> }>(`/api/natively/versions?application_id=${encodeURIComponent(id)}`);
      setVersions(r.versions); setVersionsOpen(true);
    } catch (e) { toast(errMsg(e), 'err'); }
  };
  const nativelyRestoreVersion = async (versionNumber: number) => {
    setNatBusy(`restore-${versionNumber}`);
    try {
      const r = await apiPost<{ restored_version: number; skill_name: string }>('/api/natively/versions', { application_id: id, version_number: versionNumber });
      toast(`Restored Skill version ${r.restored_version} — re-confirm import/activation in Natively`);
      setVersionsOpen(false); await load();
    } catch (e) { toast(errMsg(e), 'err'); } finally { setNatBusy(''); }
  };
  const nativelyDownload = async () => {
    setNatBusy('dl');
    try {
      const res = await fetch(`/api/natively/download?application_id=${encodeURIComponent(id)}`);
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as { error?: string }).error || `Download failed (${res.status})`); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `interview-${id}.md`; a.click(); URL.revokeObjectURL(url);
      toast('SKILL.md downloaded');
    } catch (e) { toast(errMsg(e), 'err'); } finally { setNatBusy(''); }
  };

  if (loading) return <Spinner label="Loading application…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!app) return <EmptyState title="Application not found" action={<Button onClick={() => router.push('/applications')}>Back to applications</Button>} />;

  const skillName = candidate ? `interview-${candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${app.company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${app.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`.slice(0, 120) : '';
  const matchCats = match ? [
    { label: 'Skills coverage', value: match.summary.skills_total ? (match.summary.skills_matched / match.summary.skills_total) * 100 : 50 },
    { label: 'Experience', value: match.summary.experience_required == null ? 50 : (match.summary.experience_years != null && match.summary.experience_years >= match.summary.experience_required ? 100 : 0) },
    { label: 'Certifications', value: match.summary.certifications_required.length ? (match.summary.certifications_matched.length / match.summary.certifications_required.length) * 100 : 100 },
  ] : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/applications" className="text-sm text-blue-600 hover:underline">← Applications</Link>
          <h1 className="mt-1 text-2xl font-bold">{app.company} — {app.title}</h1>
          <p className="text-sm text-gray-600">
            {candidate ? <Link className="text-blue-600 hover:underline" href={`/candidates/${candidate.id}`}>{candidate.name}</Link> : app.candidate_id}
            {app.location ? ` · ${app.location}` : ''}{app.employment_type ? ` · ${app.employment_type}` : ''}{app.stage ? ` · ${app.stage}` : ''}
          </p>
          <p className="mt-1 flex gap-1">{app.status ? <Badge tone="blue">{app.status}</Badge> : <Badge>No status</Badge>}{app.interview_date ? <Badge tone="amber">Interview {fmtDateTime(app.interview_date)}</Badge> : null}{app.archived_at ? <Badge tone="amber">Archived</Badge> : null}</p>
        </div>
        <Button onClick={() => setEditOpen(true)}>Edit application</Button>
      </div>

      <Card>
        <h2 className="font-semibold">Company &amp; role</h2>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-gray-500">Department</dt><dd>{app.department || '—'}</dd></div>
          <div><dt className="text-gray-500">Job URL</dt><dd>{app.job_url ? <a className="text-blue-600 hover:underline break-all" href={app.job_url} target="_blank" rel="noreferrer">{app.job_url}</a> : '—'}</dd></div>
          <div><dt className="text-gray-500">Application date</dt><dd>{app.application_date || '—'}</dd></div>
          <div><dt className="text-gray-500">Company notes</dt><dd className="whitespace-pre-wrap">{app.company_notes || '—'}</dd></div>
        </dl>
        <div className="mt-4">
          <Field label="Selected resume" hint="Used by Match and Natively when no resume is chosen explicitly.">
            <Select value={app.selected_resume_id || ''} onChange={async (e) => { try { const u = await apiPatch<{ application: Application }>(`/api/applications/${id}`, { selected_resume_id: e.target.value || null }); setApp(u.application); toast('Selected resume updated'); } catch (err) { toast(errMsg(err), 'err'); } }}>
              <option value="">Active resume (default)</option>
              {resumes.map((r) => <option key={r.id} value={r.id}>v{r.version} — {r.filename}{r.is_active ? ' (active)' : ''}</option>)}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">Job description</h2>
        {jdError ? <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-700" role="alert">{jdError} — paste the JD text below as a fallback.</p> : null}
        <div className="mt-3">
          <Field label="JD text">
            <Textarea rows={8} value={jdText} onChange={(e) => setJdText(e.target.value)} placeholder="Paste the full job description here…" />
          </Field>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button disabled={jdBusy || !jdText.trim()} onClick={() => saveJd({ jd_text: jdText })}>{jdBusy ? 'Saving…' : 'Save JD text'}</Button>
            <label className="cursor-pointer rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium hover:bg-gray-50">
              Upload JD file (PDF/DOCX/TXT)
              <input type="file" accept=".pdf,.docx,.txt,.md" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { const fd = new FormData(); fd.append('file', f); saveJd(fd); } e.target.value = ''; }} />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-64 flex-1"><Field label="Import from URL"><Input type="url" value={jdUrl} onChange={(e) => setJdUrl(e.target.value)} placeholder="https://… job posting" /></Field></div>
            <Button variant="secondary" disabled={jdBusy || !jdUrl.trim()} onClick={() => saveJd({ job_url: jdUrl })}>Import from URL</Button>
          </div>
          <p className="mt-1 text-xs text-gray-500">URL import fetches the posting server-side (8 s timeout). If it fails — blocked site, login wall, timeout — paste the JD text instead.</p>
        </div>
        {app.jd_parsed ? (
          <div className="mt-4 text-sm">
            <h3 className="font-semibold">Parsed JD</h3>
            <div className="mt-2 flex flex-wrap gap-1">
              {(app.jd_parsed.required_skills || []).map((s) => <Badge key={s} tone="blue">{s}</Badge>)}
              {(app.jd_parsed.keywords || []).filter((k) => !(app.jd_parsed?.required_skills || []).includes(k)).map((s) => <Badge key={s}>{s}</Badge>)}
            </div>
            <p className="mt-2 text-gray-600">
              {app.jd_parsed.experience_years != null ? `${app.jd_parsed.experience_years}+ years experience required. ` : ''}
              {app.jd_parsed.certifications?.length ? `Certifications: ${app.jd_parsed.certifications.join(', ')}. ` : ''}
              {app.jd_parsed.responsibilities?.length ? `${app.jd_parsed.responsibilities.length} responsibilities extracted.` : ''}
            </p>
          </div>
        ) : <p className="mt-3 text-sm text-gray-500">No JD on file yet — paste text, upload a file, or import from a URL.</p>}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Match analysis</h2>
          <Button onClick={runMatch} disabled={matchBusy || !app.jd_text}>{matchBusy ? 'Running…' : 'Run Match'}</Button>
        </div>
        {!app.jd_text ? <p className="mt-2 text-sm text-gray-500">Add a job description first — matching compares the resume against the JD.</p> : null}
        {matchError ? <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-700" role="alert">{matchError}</p> : null}
        {match ? (
          <div className="mt-4 space-y-4">
            <ScoreBar value={match.score} label="Overall match" />
            <div className="grid gap-3 sm:grid-cols-3">{matchCats.map((c) => <ScoreBar key={c.label} value={c.value} label={c.label} />)}</div>
            <p className="text-xs text-gray-500">{match.summary.skills_matched}/{match.summary.skills_total} required skills matched · Experience: {match.summary.experience_years ?? 'unknown'} yrs vs {match.summary.experience_required ?? '—'} required · Method: {match.method}{match.ai_refined ? '' : ' (deterministic heuristic — no AI refinement)'}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left"><th className="py-2 pr-2">Requirement</th><th className="py-2 pr-2">Result</th><th className="py-2">Evidence</th></tr></thead>
                <tbody>
                  {match.requirements.map((r, i) => (
                    <tr key={i} className="border-b align-top">
                      <td className="py-2 pr-2 font-medium">{r.requirement}</td>
                      <td className="py-2 pr-2">{r.demonstrated ? <Badge tone="green">Strong</Badge> : r.evidence !== 'Not demonstrated' ? <Badge tone="amber">Partial</Badge> : <Badge tone="red">Not demonstrated</Badge>}</td>
                      <td className="py-2 text-gray-600">{r.evidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Interview prep</h2>
          <div className="flex gap-2">
            <Button onClick={genQuestions} disabled={qBusy}>{qBusy ? 'Generating…' : 'Generate questions'}</Button>
            <Button variant="secondary" onClick={genAnswers} disabled={aBusy || !questions.length}>{aBusy ? 'Drafting…' : 'Generate answers'}</Button>
          </div>
        </div>
        {questions.length === 0 ? <p className="mt-2 text-sm text-gray-500">No questions yet. Questions are generated from the JD (template fallback today; AI refinement plugs in later).</p> : (
          <div className="mt-4 space-y-4">
            {groupedQuestions.map(([cat, qs]) => (
              <div key={cat}>
                <h3 className="font-semibold">{cat} ({qs.length})</h3>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">{qs.map((q, i) => <li key={i}>{q.question}<span className="block text-xs text-gray-400">{q.source}</span></li>)}</ol>
              </div>
            ))}
          </div>
        )}
        {answers.length > 0 ? (
          <div className="mt-6 space-y-4 border-t pt-4">
            <h3 className="font-semibold">Draft answers (evidence only — verify before using)</h3>
            {answers.map((a, i) => (
              <div key={i} className="rounded border p-3">
                <p className="text-sm font-medium">{a.question} <Badge tone="gray">{a.category}</Badge></p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{a.answer}</p>
                {a.evidence.length ? <p className="mt-2 text-xs text-gray-500"><span className="font-semibold">Evidence refs:</span> {a.evidence.map((e) => e.slice(0, 120)).join(' | ')}</p> : null}
                {a.gaps.length ? <p className="mt-1 text-xs text-amber-700">Gaps: {a.gaps.join('; ')}</p> : null}
              </div>
            ))}
          </div>
        ) : null}
        {questions.length > 0 ? (
          <div className="mt-6 space-y-3 border-t pt-4">
            <h3 className="font-semibold">Save as interview session</h3>
            <Field label="Session title"><Input value={sessionTitle} onChange={(e) => setSessionTitle(e.target.value)} placeholder={`Prep — ${app.company} ${app.title}`} /></Field>
            <Field label="Session notes"><Textarea rows={2} value={sessionNotes} onChange={(e) => setSessionNotes(e.target.value)} placeholder="Notes for this session…" /></Field>
            <Button onClick={saveSession}>Save interview session</Button>
          </div>
        ) : null}
        {sessions.length > 0 ? (
          <div className="mt-6 border-t pt-4">
            <h3 className="font-semibold">Saved sessions ({sessions.length})</h3>
            <ul className="mt-2 space-y-2 text-sm">{sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                <span>{s.title || 'Untitled session'} — {s.questions.length} Qs · {fmtDateTime(s.created_at)}</span>
                <Button variant="danger" onClick={async () => { if (!window.confirm(`Delete session “${s.title || 'Untitled'}”?`)) return; try { const res = await fetch(`/api/interview-sessions/${s.id}`, { method: 'DELETE' }); if (!res.ok) throw new Error('Delete failed'); toast('Session deleted'); await load(); } catch (e) { toast(errMsg(e), 'err'); } }}>Delete</Button>
              </li>
            ))}</ul>
          </div>
        ) : null}
      </Card>

      <Card>
        <h2 className="font-semibold">Interview notes</h2>
        <div className="mt-3"><Textarea rows={4} value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} placeholder="Free-form notes for this application…" aria-label="Interview notes" /></div>
        <Button className="mt-2" variant="secondary" onClick={saveNotes} disabled={notesSaving}>{notesSaving ? 'Saving…' : 'Save notes'}</Button>
      </Card>

      <Card>
        <h2 className="font-semibold">Natively skill — file-based export</h2>
        <p className="mt-1 text-sm text-gray-600">Naming convention: <code className="rounded bg-gray-100 px-1">{skillName || 'interview-{candidate}-{company}-{role}'}</code></p>
        {syncs.length ? (
          <div className="mt-3 space-y-1 text-sm">
            <p>
              Status: <Badge tone={NATIVELY_STATUS_TONE[syncs[0].status || ''] || 'gray'}>{syncs[0].status || 'unknown'}</Badge>
              {natOutdated ? <span className="ml-2"><Badge tone="red">Outdated — resume or JD changed</Badge></span> : null}
            </p>
            <p className="break-all"><span className="text-gray-500">File:</span> {syncs[0].skill_name}.md</p>
            <p className="break-all"><span className="text-gray-500">Path:</span> {syncs[0].skill_path || '—'}</p>
            <p><span className="text-gray-500">Output directory:</span> {natOutputDir || '—'}</p>
            <p><span className="text-gray-500">Last generated:</span> {fmtDateTime(syncs[0].last_synced)}</p>
            <p><span className="text-gray-500">Resume version:</span> {syncs[0].resume_version ?? '—'} · <span className="text-gray-500">JD version:</span> {syncs[0].jd_hash ? syncs[0].jd_hash.slice(0, 12) : '—'}</p>
            {syncs[0].error ? <p className="text-red-700">Error: {syncs[0].error}</p> : null}
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-500">Not generated yet. The Skill uses the application&apos;s selected resume ({app.selected_resume_id ? `v${resumes.find((r) => r.id === app.selected_resume_id)?.version ?? '?'}` : 'active version'}) and the stored JD.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={nativelyPreview} disabled={natBusy === 'preview' || !app.jd_text}>{natBusy === 'preview' ? 'Loading…' : 'Preview'}</Button>
          <Button onClick={() => nativelyGenerate(false)} disabled={natBusy === 'gen' || !app.jd_text}>{natBusy === 'gen' ? 'Generating…' : syncs.length ? 'Regenerate' : 'Generate Natively Skill'}</Button>
          <Button variant="secondary" onClick={nativelyDownload} disabled={natBusy === 'dl' || !syncs.length}>{natBusy === 'dl' ? 'Downloading…' : 'Download'}</Button>
          <Button variant="secondary" onClick={nativelyCopyPath} disabled={!syncs.length}>Copy file path</Button>
          <Button variant="secondary" onClick={nativelyLoadVersions} disabled={!syncs.length}>Version history</Button>
        </div>
        {syncs.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => nativelyConfirm('imported')} disabled={natBusy.startsWith('confirm') || syncs[0].status === 'imported' || syncs[0].status === 'activation_verified'}>Mark as imported</Button>
            <Button variant="secondary" onClick={() => nativelyConfirm('activated')} disabled={natBusy.startsWith('confirm') || syncs[0].status !== 'imported'}>Mark activation verified</Button>
            <Button variant="secondary" onClick={() => nativelyConfirm('outdated')} disabled={natBusy.startsWith('confirm') || syncs[0].status === 'outdated'}>Mark as outdated</Button>
            <Button variant="danger" onClick={nativelyDelete} disabled={natBusy === 'del'}>Delete Skill</Button>
          </div>
        ) : null}
        <div className="mt-4 rounded bg-gray-50 p-3 text-sm">
          <p className="font-semibold">Manual import into Natively</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-gray-700">
            {NATIVELY_IMPORT_STEPS.map((s) => <li key={s}>{s}</li>)}
          </ol>
          <p className="mt-2 text-xs text-amber-700">A generated file is NOT proof Natively loaded it. Import and activation are confirmed only when you click “Mark as imported” / “Mark activation verified” above after doing the steps in Natively. This Skill works without Natively Pro&apos;s Reference Files feature.</p>
        </div>
      </Card>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview ? `Preview — ${preview.skill_name}.md` : ''} wide>
        {preview ? (
          <div className="space-y-3">
            {preview.truncated ? <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">Excerpts used — {preview.omitted_chars} characters omitted. The full resume and JD remain in InterviewHub.</p> : <p className="rounded bg-green-50 p-2 text-sm text-green-800">Complete documents included — nothing omitted.</p>}
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border bg-gray-50 p-3 text-xs">{preview.content}</pre>
            <div className="flex gap-2">
              <Button onClick={() => { setPreview(null); nativelyGenerate(false); }}>Generate this Skill</Button>
              <Button variant="secondary" onClick={() => setPreview(null)}>Close</Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={versionsOpen} onClose={() => setVersionsOpen(false)} title="Skill version history">
        {versions.length === 0 ? <p className="text-sm text-gray-500">No previous versions saved yet — a version is saved each time a Skill is regenerated over an existing file.</p> : (
          <ul className="space-y-2 text-sm">
            {versions.map((v) => (
              <li key={v.version_number} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                <span>v{v.version_number} — {fmtDateTime(v.created_at)} · {v.content_chars} chars</span>
                <Button variant="secondary" onClick={() => nativelyRestoreVersion(v.version_number)} disabled={natBusy === `restore-${v.version_number}`}>Restore this version</Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal open={confirmRegen} onClose={() => setConfirmRegen(false)} title="Regenerate Skill?">
        <p className="text-sm text-gray-700">A Skill file already exists for this application. Regenerating replaces it — the previous version is saved and can be restored from Version history.</p>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => nativelyGenerate(true)}>Regenerate and replace</Button>
          <Button variant="secondary" onClick={() => setConfirmRegen(false)}>Cancel</Button>
        </div>
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Edit ${app.company} — ${app.title}`} wide>
        <ApplicationForm initial={app} candidates={candidates} saving={saving} onCancel={() => setEditOpen(false)} onSubmit={async (d: ApplicationFormData) => {
          setSaving(true);
          try { const { candidate_id: _cid, ...patch } = d; const u = await apiPatch<{ application: Application }>(`/api/applications/${id}`, patch); setApp(u.application); setJdText(u.application.jd_text || ''); toast('Application updated'); setEditOpen(false); }
          catch (e) { toast(errMsg(e), 'err'); } finally { setSaving(false); }
        }} />
      </Modal>
    </div>
  );
}
