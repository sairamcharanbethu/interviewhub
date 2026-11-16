'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiGet, apiPost } from '@/lib/api';
import { useApp } from '@/components/context';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Select, Spinner, Textarea } from '@/components/ui';
import type { Application, Candidate, InterviewSession, PrepAnswer, PrepQuestion } from '@/lib/types';
import { errMsg, fmtDateTime } from '@/lib/types';

export default function PrepPage() {
  const { toast, candidateId, applicationId, setCandidateId, setApplicationId, setPrepInProgress, prepInProgress } = useApp();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  const [sessions, setSessions] = useState<InterviewSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [questions, setQuestions] = useState<PrepQuestion[]>([]);
  const [answers, setAnswers] = useState<PrepAnswer[]>([]);
  const [qBusy, setQBusy] = useState(false);
  const [aBusy, setABusy] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');

  const loadLists = async () => {
    setLoading(true); setError('');
    try {
      const c = await apiGet<{ candidates: Candidate[] }>('/api/candidates');
      setCandidates(c.candidates);
      if (candidateId) {
        const a = await apiGet<{ applications: Application[] }>(`/api/applications?candidate_id=${encodeURIComponent(candidateId)}`);
        setApps(a.applications);
        const s = await apiGet<{ interview_sessions: InterviewSession[] }>(`/api/interview-sessions?candidate_id=${encodeURIComponent(candidateId)}`);
        setSessions(s.interview_sessions);
      } else { setApps([]); setSessions([]); }
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  };
  useEffect(() => { loadLists(); }, [candidateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    const m = new Map<string, PrepQuestion[]>();
    for (const q of questions) { const arr = m.get(q.category) || []; arr.push(q); m.set(q.category, arr); }
    return [...m.entries()];
  }, [questions]);

  const genQuestions = async () => {
    if (!applicationId) { toast('Pick an application first', 'err'); return; }
    setQBusy(true); setPrepInProgress(true);
    try {
      const r = await apiPost<{ questions: PrepQuestion[] }>(`/api/applications/${applicationId}/prep/questions`, {});
      setQuestions(r.questions); setAnswers([]); toast(`${r.questions.length} questions generated`);
    } catch (e) { toast(errMsg(e), 'err'); } finally { setQBusy(false); }
  };
  const genAnswers = async () => {
    if (!applicationId || !questions.length) return;
    setABusy(true);
    try {
      const r = await apiPost<{ answers: PrepAnswer[] }>(`/api/applications/${applicationId}/prep/answers`, { questions: questions.map((q) => ({ question: q.question, category: q.category })) });
      setAnswers(r.answers); toast(`${r.answers.length} answers drafted`);
    } catch (e) { toast(errMsg(e), 'err'); } finally { setABusy(false); }
  };
  const saveSession = async () => {
    if (!applicationId || !candidateId) return;
    try {
      await apiPost('/api/interview-sessions', {
        application_id: applicationId, candidate_id: candidateId,
        title: title.trim() || 'Interview prep session',
        questions: questions.map((q) => ({ category: q.category, question: q.question })),
        answers: answers.map((a) => ({ question: a.question, category: a.category, answer: a.answer, evidence: a.evidence, gaps: a.gaps })),
        notes: notes.trim() || null,
      });
      toast('Session saved'); setPrepInProgress(false); setTitle(''); setNotes(''); await loadLists();
    } catch (e) { toast(errMsg(e), 'err'); }
  };
  const endSession = () => { setPrepInProgress(false); toast('Prep session marked finished'); };

  if (loading) return <Spinner label="Loading prep…" />;
  if (error) return <ErrorBox error={error} onRetry={loadLists} />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Interview Prep</h1>
      {prepInProgress ? <p className="rounded bg-amber-50 p-3 text-sm text-amber-800" role="status">⚠ A prep session is in progress — switching candidate or application will warn you first. <Button variant="ghost" onClick={endSession}>Mark finished</Button></p> : null}
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Candidate">
            <Select value={candidateId || ''} onChange={(e) => { setCandidateId(e.target.value || null); setQuestions([]); setAnswers([]); }}>
              <option value="">Select candidate…</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Application">
            <Select value={applicationId || ''} onChange={(e) => { setApplicationId(e.target.value || null); setQuestions([]); setAnswers([]); }} disabled={!candidateId}>
              <option value="">Select application…</option>
              {apps.map((a) => <option key={a.id} value={a.id}>{a.company} — {a.title}</option>)}
            </Select>
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={genQuestions} disabled={qBusy || !applicationId}>{qBusy ? 'Generating…' : 'Generate questions'}</Button>
          <Button variant="secondary" onClick={genAnswers} disabled={aBusy || !questions.length}>{aBusy ? 'Drafting…' : 'Generate answers'}</Button>
          {applicationId ? <Link href={`/applications/${applicationId}`}><Button variant="ghost">Open application →</Button></Link> : null}
        </div>
      </Card>

      {questions.length === 0 ? (
        <EmptyState title="No questions generated yet" body="Pick a candidate and application above, then generate questions from the JD." />
      ) : (
        <Card>
          <h2 className="font-semibold">Questions ({questions.length})</h2>
          <div className="mt-3 space-y-4">
            {grouped.map(([cat, qs]) => (
              <div key={cat}>
                <h3 className="font-semibold">{cat} ({qs.length})</h3>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">{qs.map((q, i) => <li key={i}>{q.question}</li>)}</ol>
              </div>
            ))}
          </div>
          {answers.length > 0 ? (
            <div className="mt-6 space-y-4 border-t pt-4">
              <h3 className="font-semibold">Draft answers</h3>
              {answers.map((a, i) => (
                <div key={i} className="rounded border p-3">
                  <p className="text-sm font-medium">{a.question} <Badge tone="gray">{a.category}</Badge></p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{a.answer}</p>
                  {a.gaps.length ? <p className="mt-1 text-xs text-amber-700">Gaps: {a.gaps.join('; ')}</p> : null}
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-6 space-y-3 border-t pt-4">
            <h3 className="font-semibold">Save as interview session</h3>
            <Field label="Session title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Interview prep session" /></Field>
            <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <Button onClick={saveSession}>Save session</Button>
          </div>
        </Card>
      )}

      <Card>
        <h2 className="font-semibold">Session history {candidateId ? '(selected candidate)' : ''}</h2>
        {sessions.length === 0 ? <p className="mt-2 text-sm text-gray-500">No sessions yet.</p> : (
          <ul className="mt-3 space-y-2 text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3">
                <span><span className="font-medium">{s.title || 'Untitled session'}</span> — {s.questions.length} questions · {s.answers.length} answers · {fmtDateTime(s.created_at)}{s.notes ? <span className="block text-xs text-gray-500">{s.notes}</span> : null}</span>
                <Button variant="danger" onClick={async () => { if (!window.confirm('Delete this session?')) return; try { const res = await fetch(`/api/interview-sessions/${s.id}`, { method: 'DELETE' }); if (!res.ok) throw new Error('Delete failed'); toast('Session deleted'); await loadLists(); } catch (e) { toast(errMsg(e), 'err'); } }}>Delete</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
