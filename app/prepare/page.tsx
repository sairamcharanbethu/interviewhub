'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { apiGet, apiPost } from '@/lib/api';
import { Button, Card, ErrorBox, Field, Input, Spinner } from '@/components/ui';
import { errMsg } from '@/lib/types';

type JobState = {
  jobId: string; status: string; currentStage: string | null; currentStageLabel: string | null;
  progress: number; stageResults: Record<string, { status: string; origin?: string; error?: string; detail?: Record<string, unknown> }>;
  errorDetails: Record<string, unknown> | null; candidateId: string | null; applicationId: string | null;
  originSummary: Record<string, string> | null; duplicateFlags: Record<string, unknown> | null;
  install: { status: string; detail: Record<string, unknown> | null; error: string | null } | null;
  skill: { status: string; detail: Record<string, unknown> | null; error: string | null } | null;
};

const STAGE_ORDER = ['reading_resume', 'building_profile', 'analyzing_jd', 'role_insight', 'questions_answers', 'star_study', 'company_research', 'building_skill', 'installing_natively', 'ready'];
const STAGE_LABELS: Record<string, string> = {
  reading_resume: 'Reading resume', building_profile: 'Building candidate profile', analyzing_jd: 'Analyzing job requirements',
  role_insight: 'Analyzing role fit', questions_answers: 'Preparing interview questions and answers', star_study: 'Building STAR stories and study guide',
  company_research: 'Researching the company', building_skill: 'Building Natively Skill', installing_natively: 'Installing into Natively', ready: 'Ready',
};

export default function PreparePage() {
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [jdTab, setJdTab] = useState<'paste' | 'url' | 'file'>('paste');
  const [jdText, setJdText] = useState('');
  const [jdUrl, setJdUrl] = useState('');
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [job, setJob] = useState<JobState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPath, setConfirmPath] = useState('');
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [confirmSaving, setConfirmSaving] = useState(false);
  const [candidate, setCandidate] = useState<Record<string, unknown> | null>(null);
  const [application, setApplication] = useState<Record<string, unknown> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => stopPolling, []);

  const pollJob = useCallback(async (jobId: string) => {
    try {
      const j = await apiGet<JobState>(`/api/prepare/${jobId}`);
      setJob(j);
      if (j.status === 'completed' || j.status === 'failed' || j.status === 'partial') {
        stopPolling();
        if (j.candidateId) apiGet<{ candidate: Record<string, unknown> }>(`/api/candidates/${j.candidateId}`).then((r) => setCandidate(r.candidate)).catch(() => undefined);
        if (j.applicationId) apiGet<{ application: Record<string, unknown> }>(`/api/applications/${j.applicationId}`).then((r) => setApplication(r.application)).catch(() => undefined);
      }
    } catch (e) { setError(errMsg(e)); stopPolling(); }
  }, []);

  const submit = async () => {
    setError('');
    if (!resumeFile) { setError('Choose a resume file first (PDF, DOCX, TXT, or MD).'); return; }
    if (jdTab === 'paste' && !jdText.trim()) { setError('Paste the job description text first.'); return; }
    if (jdTab === 'url' && !jdUrl.trim()) { setError('Enter the job posting URL first.'); return; }
    if (jdTab === 'file' && !jdFile) { setError('Choose a job description file first.'); return; }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('resume', resumeFile);
      if (jdTab === 'paste') fd.append('jd_text', jdText);
      if (jdTab === 'url') fd.append('jd_url', jdUrl);
      if (jdTab === 'file' && jdFile) fd.append('jd_file', jdFile);
      const res = await fetch('/api/prepare', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Prepare failed (${res.status})`);
      const jobId = data.jobId as string;
      await pollJob(jobId);
      pollRef.current = setInterval(() => void pollJob(jobId), 2000);
    } catch (e) { setError(errMsg(e)); } finally { setSubmitting(false); }
  };

  const startWithConfirmCheck = async () => {
    setError('');
    try {
      const cfg = await apiGet<{ confirmed_natively_dir: string | null; install_dir: { resolved_path: string | null; verified: boolean } }>('/api/natively/install-config');
      if (!cfg.confirmed_natively_dir && cfg.install_dir?.resolved_path) {
        setConfirmPath(cfg.install_dir.resolved_path);
        setConfirmChecked(false);
        setConfirmOpen(true);
        return;
      }
      await submit();
    } catch (e) { setError(errMsg(e)); }
  };

  const confirmAndSubmit = async () => {
    if (!confirmChecked) return;
    setConfirmSaving(true);
    try {
      await apiPost('/api/natively/confirm', { action: 'confirm_directory', directory: confirmPath });
      setConfirmOpen(false);
      await submit();
    } catch (e) { setError(errMsg(e)); } finally { setConfirmSaving(false); }
  };

  const retry = async () => {
    if (!job) return;
    setError('');
    try {
      await apiPost(`/api/prepare/${job.jobId}/retry`, {});
      pollRef.current = setInterval(() => void pollJob(job.jobId), 2000);
    } catch (e) { setError(errMsg(e)); }
  };

  const done = job && (job.status === 'completed' || job.status === 'partial' || job.status === 'failed');
  const originLabel = (o?: string | null) => (o === 'ai' ? 'Generated with AI' : o === 'fallback' ? 'Template fallback — AI unavailable' : null);
  const score = (job?.stageResults.role_insight?.detail?.overallScore as number | undefined) ?? null;
  const questionCount = (job?.stageResults.questions_answers?.detail?.questionCount as number | undefined) ?? null;
  const starCount = (job?.stageResults.star_study?.detail?.starDrafts as number | undefined) ?? null;
  const skillDetail = job?.skill?.detail as Record<string, unknown> | undefined;
  const installDetail = job?.install?.detail as Record<string, unknown> | undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Prepare Interview</h1>
        <p className="text-sm text-gray-500">Upload a resume and a job description — InterviewHub builds the candidate profile, role analysis, questions and answers, STAR drafts, and a Natively Skill, then installs it. One click; no AI provider is required (template fallback is used and labelled when AI is unavailable).</p>
      </div>

      {!job ? (
        <Card>
          <div className="space-y-4">
            <Field label="Resume (PDF, DOCX, TXT, or MD)">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) setResumeFile(f); }}
                className="rounded-lg border-2 border-dashed border-gray-300 p-6 text-center"
              >
                <p className="text-sm text-gray-600">{resumeFile ? `Selected: ${resumeFile.name}` : 'Drag your resume here, or choose a file'}</p>
                <Input type="file" accept=".pdf,.docx,.txt,.md" onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)} />
              </div>
            </Field>
            <div>
              <p className="mb-2 text-sm font-medium">Job description</p>
              <div className="mb-2 flex gap-2">
                {(['paste', 'url', 'file'] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setJdTab(t)} className={`rounded-lg px-3 py-1.5 text-sm ${jdTab === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
                    {t === 'paste' ? 'Paste text' : t === 'url' ? 'URL' : 'Upload file'}
                  </button>
                ))}
              </div>
              {jdTab === 'paste' && <textarea value={jdText} onChange={(e) => setJdText(e.target.value)} rows={10} placeholder="Paste the full job description here…" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />}
              {jdTab === 'url' && <Input type="url" value={jdUrl} onChange={(e) => setJdUrl(e.target.value)} placeholder="https://… job posting URL" />}
              {jdTab === 'file' && <Input type="file" accept=".pdf,.docx,.txt,.md" onChange={(e) => setJdFile(e.target.files?.[0] ?? null)} />}
              {jdTab === 'file' && jdFile && <p className="mt-1 text-sm text-gray-600">Selected: {jdFile.name}</p>}
            </div>
            {error ? <ErrorBox error={error} /> : null}
            <Button onClick={() => void startWithConfirmCheck()} disabled={submitting}>{submitting ? 'Starting…' : 'Prepare Interview'}</Button>
            <p className="text-xs text-gray-500">First time: you will be asked once to confirm Natively&apos;s Skills directory. Preparation runs in the background while this server is running.</p>
          </div>
        </Card>
      ) : (
        <Card>
          <h2 className="font-semibold">{done ? (job.status === 'failed' ? 'Preparation failed' : job.status === 'partial' ? 'Preparation finished with warnings' : 'Ready') : (job.currentStageLabel || 'Working…')}</h2>
          <div className="mt-3 h-2 w-full rounded bg-gray-200" role="progressbar" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Preparation progress">
            <div className="h-2 rounded bg-blue-600" style={{ width: `${job.progress}%` }} />
          </div>
          <p className="mt-1 text-sm text-gray-600">{job.progress}% — {job.currentStageLabel || job.status}</p>
          <ul className="mt-4 space-y-1 text-sm">
            {STAGE_ORDER.filter((s) => s !== 'ready').map((s) => {
              const r = job.stageResults[s];
              return (
                <li key={s} className="flex items-center gap-2">
                  <span>{r?.status === 'completed' ? '✓' : r?.status === 'failed' ? '✗' : r?.status === 'skipped' ? '–' : job.currentStage === s ? '…' : '○'}</span>
                  <span>{STAGE_LABELS[s]}</span>
                  {r?.origin ? <span className="text-xs text-gray-500">({originLabel(r.origin)})</span> : null}
                  {r?.error ? <span className="text-xs text-red-600">{r.error}</span> : null}
                </li>
              );
            })}
          </ul>
          {error ? <div className="mt-3"><ErrorBox error={error} /></div> : null}
          {job.errorDetails ? <p className="mt-3 text-sm text-red-700">{String((job.errorDetails as Record<string, unknown>).message || JSON.stringify(job.errorDetails))}</p> : null}
          {done && job.status === 'failed' ? <Button className="mt-4" onClick={() => void retry()}>Retry failed stages</Button> : null}
          {done && job.status === 'partial' ? <Button className="mt-4" variant="secondary" onClick={() => void retry()}>Retry failed stages</Button> : null}
        </Card>
      )}

      {confirmOpen ? (
        <Card>
          <h2 className="font-semibold">Confirm Natively&apos;s Skills directory</h2>
          <p className="mt-2 text-sm text-gray-600">InterviewHub will install the generated Skill into this folder. Please confirm it really is Natively&apos;s Skills directory:</p>
          <p className="mt-2 rounded bg-gray-100 p-2 font-mono text-sm">{confirmPath}</p>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} />
            I confirm this is Natively&apos;s Skills directory
          </label>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => void confirmAndSubmit()} disabled={!confirmChecked || confirmSaving}>{confirmSaving ? 'Saving…' : 'Confirm and prepare'}</Button>
            <Button variant="secondary" onClick={() => { setConfirmOpen(false); void submit(); }}>Skip — prepare without installing</Button>
          </div>
        </Card>
      ) : null}

      {done && job.status !== 'failed' ? (
        <Card>
          <h2 className="font-semibold">Results</h2>
          {candidate ? <p className="mt-2 text-sm"><strong>Candidate:</strong> {String(candidate.name || '')}{candidate.headline ? ` — ${String(candidate.headline)}` : ''}{typeof candidate.total_experience_years === 'number' ? ` (${candidate.total_experience_years} yrs)` : ''}</p> : null}
          {application ? <p className="mt-1 text-sm"><strong>Target role:</strong> {String(application.company)} — {String(application.title)}{score !== null ? ` · Overall match ${score}/100` : ''} {job.originSummary?.role_insight ? `(${originLabel(job.originSummary.role_insight)})` : ''}</p> : null}
          <ul className="mt-2 space-y-1 text-sm">
            <li><strong>Preparation:</strong> {questionCount ?? '—'} questions{starCount !== null ? `, ${starCount} STAR drafts created (unverified)` : ''}</li>
            {job.duplicateFlags ? <li className="text-amber-700">⚠ Multiple candidates matched this email — a new candidate was created and the duplicates were flagged, not merged.</li> : null}
            <li><strong>Natively:</strong> {job.install?.status === 'completed'
              ? `Installed — use ${String(installDetail?.slashCommand || '')} in Natively${installDetail?.installPath ? ` (${String(installDetail.installPath)})` : ''}`
              : job.install?.status === 'failed'
                ? `Not installed: ${job.install.error || 'install failed'}. ${skillDetail?.skillName ? `The Skill file (${String(skillDetail.skillName)}.md) is saved in InterviewHub and can be installed from the Natively page.` : ''}`
                : 'Install status unknown — check the Natively page.'}
            </li>
          </ul>
          {job.install?.status === 'completed' ? (
            <p className="mt-3 rounded bg-green-50 p-3 text-sm text-green-800">Next step: open Natively and use <code>{String(installDetail?.slashCommand || '')}</code></p>
          ) : null}
          {application ? <p className="mt-3 text-sm"><Link className="text-blue-600 hover:underline" href={`/applications/${String(application.id)}`}>View the application for full detail →</Link></p> : null}
          <Button className="mt-4" variant="secondary" onClick={() => { setJob(null); setCandidate(null); setApplication(null); setResumeFile(null); setJdText(''); }}>Prepare another interview</Button>
        </Card>
      ) : null}
    </div>
  );
}
