'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { useApp } from '@/components/context';
import { Badge, Button, Card, EmptyState, ErrorBox, Spinner } from '@/components/ui';
import type { Application, Candidate, InterviewSession } from '@/lib/types';
import { errMsg, fmtDate, fmtDateTime } from '@/lib/types';

export default function Dashboard() {
  const { candidateId, setApplicationId } = useApp();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [sessions, setSessions] = useState<InterviewSession[]>([]);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [c, a] = await Promise.all([
        apiGet<{ candidates: Candidate[] }>('/api/candidates'),
        apiGet<{ applications: Application[] }>('/api/applications'),
      ]);
      setCandidates(c.candidates); setApplications(a.applications);
      if (c.candidates.length) {
        const s = await apiGet<{ interview_sessions: InterviewSession[] }>(`/api/interview-sessions?candidate_id=${encodeURIComponent(c.candidates[0].id)}`);
        setSessions(s.interview_sessions.slice(0, 5));
      } else setSessions([]);
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Spinner label="Loading dashboard…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;

  const activeStatuses = ['applied', 'interview', 'interviewing', 'screening', 'offer', 'in progress'];
  const active = applications.filter((a) => !a.archived_at && (!a.status || activeStatuses.includes(a.status.toLowerCase())));
  const upcoming = applications
    .filter((a) => a.interview_date && new Date(a.interview_date.replace(' ', 'T')) >= new Date(Date.now() - 86400000))
    .sort((x, y) => String(x.interview_date).localeCompare(String(y.interview_date))).slice(0, 5);
  const statusCounts = new Map<string, number>();
  for (const a of applications) statusCounts.set(a.status || 'No status', (statusCounts.get(a.status || 'No status') || 0) + 1);
  const recentCandidates = [...candidates].sort((x, y) => String(y.updated_at).localeCompare(String(x.updated_at))).slice(0, 5);
  const noJd = applications.filter((a) => !a.jd_text);
  const candIdsWithApps = new Set(applications.map((a) => a.candidate_id));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-gray-500">Everything live from your local database — no sample numbers.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/candidates"><Button variant="secondary">+ New candidate</Button></Link>
          <Link href="/applications"><Button>+ New application</Button></Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card><p className="text-sm text-gray-500">Total profiles</p><p className="mt-1 text-3xl font-bold">{candidates.length}</p><p className="text-xs text-gray-500">{candidates.filter((c) => c.is_default).length ? '1 default profile' : 'No default profile set'}</p></Card>
        <Card><p className="text-sm text-gray-500">Active applications</p><p className="mt-1 text-3xl font-bold">{active.length}</p><p className="text-xs text-gray-500">of {applications.length} total</p></Card>
        <Card><p className="text-sm text-gray-500">Upcoming interviews</p><p className="mt-1 text-3xl font-bold">{upcoming.length}</p><p className="text-xs text-gray-500">{upcoming[0] ? `Next: ${fmtDate(upcoming[0].interview_date)}` : 'None scheduled'}</p></Card>
        <Card><p className="text-sm text-gray-500">Interview sessions</p><p className="mt-1 text-3xl font-bold">{sessions.length}</p><p className="text-xs text-gray-500">recent, default candidate</p></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Application status</h2>
          {statusCounts.size === 0 ? <EmptyState title="No applications yet" body="Create your first application to track it here." action={<Link href="/applications"><Button>Go to Applications</Button></Link>} /> : (
            <ul className="mt-3 space-y-2">
              {[...statusCounts.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                <li key={s} className="flex items-center justify-between text-sm"><span className="flex items-center gap-2"><Badge tone="blue">{s}</Badge></span><span className="font-medium">{n}</span></li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="font-semibold">Upcoming interviews</h2>
          {upcoming.length === 0 ? <p className="mt-3 text-sm text-gray-500">No interviews scheduled. Set an interview date on an application.</p> : (
            <ul className="mt-3 space-y-3">
              {upcoming.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                  <span><Link className="font-medium text-blue-600 hover:underline" href={`/applications/${a.id}`}>{a.company} — {a.title}</Link><span className="block text-xs text-gray-500">{a.status || 'No status'}</span></span>
                  <span className="shrink-0">{fmtDate(a.interview_date)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Recently updated candidates</h2>
          {recentCandidates.length === 0 ? <p className="mt-3 text-sm text-gray-500">No candidates yet.</p> : (
            <ul className="mt-3 space-y-2">
              {recentCandidates.map((c) => (
                <li key={c.id} className="flex items-center justify-between text-sm">
                  <Link className="font-medium text-blue-600 hover:underline" href={`/candidates/${c.id}`}>{c.name}</Link>
                  <span className="text-gray-500">{fmtDateTime(c.updated_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="font-semibold">Recent interview sessions</h2>
          {sessions.length === 0 ? <p className="mt-3 text-sm text-gray-500">No sessions saved yet. Generate prep on an application and save it as a session.</p> : (
            <ul className="mt-3 space-y-2">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between text-sm">
                  <span>{s.title || 'Untitled session'}</span>
                  <span className="text-gray-500">{fmtDateTime(s.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="font-semibold">Outstanding tasks</h2>
        {noJd.length === 0 && candidates.filter((c) => !candIdsWithApps.has(c.id)).length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">Nothing outstanding — every application has a JD and every candidate has at least one application.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {noJd.map((a) => (
              <li key={a.id}>⚠ <Link className="text-blue-600 hover:underline" href={`/applications/${a.id}`}>{a.company} — {a.title}</Link> has no job description yet.</li>
            ))}
            {candidates.filter((c) => !candIdsWithApps.has(c.id)).map((c) => (
              <li key={c.id}>⚠ <Link className="text-blue-600 hover:underline" href={`/candidates/${c.id}`}>{c.name}</Link> has no applications yet.</li>
            ))}
            {!candidateId ? <li>⚠ No candidate selected in the header — pick one to scope prep and Natively.</li> : null}
          </ul>
        )}
      </Card>
    </div>
  );
}
