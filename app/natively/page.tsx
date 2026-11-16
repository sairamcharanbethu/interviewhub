'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, apiPost } from '@/lib/api';
import { useApp } from '@/components/context';
import { Badge, Button, Card, EmptyState, ErrorBox, Spinner } from '@/components/ui';
import type { Application, SkillSync } from '@/lib/types';
import { errMsg, fmtDateTime } from '@/lib/types';

interface SkillFile { name: string; path: string }

export default function NativelyPage() {
  const { toast, candidateId } = useApp();
  const [apps, setApps] = useState<Application[]>([]);
  const [files, setFiles] = useState<SkillFile[]>([]);
  const [syncsByApp, setSyncsByApp] = useState<Record<string, SkillSync[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [a, f] = await Promise.all([
        apiGet<{ applications: Application[] }>(`/api/applications?include_archived=true${candidateId ? `&candidate_id=${encodeURIComponent(candidateId)}` : ''}`),
        apiGet<{ skills: SkillFile[] }>('/api/natively/status'),
      ]);
      setApps(a.applications); setFiles(f.skills);
      const map: Record<string, SkillSync[]> = {};
      for (const app of a.applications) {
        const s = await apiGet<{ syncs: SkillSync[] }>(`/api/natively/status?application_id=${encodeURIComponent(app.id)}`);
        map[app.id] = s.syncs;
      }
      setSyncsByApp(map);
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [candidateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async (appId: string) => {
    setBusy(appId);
    try {
      const r = await apiPost<{ skill_name: string; skill_path: string; status: string }>('/api/natively/generate', { application_id: appId });
      toast(`Generated ${r.skill_name}`); await load();
    } catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(''); }
  };
  const download = async (appId: string) => {
    setBusy(`dl-${appId}`);
    try {
      const res = await fetch(`/api/natively/download?application_id=${encodeURIComponent(appId)}`);
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as { error?: string }).error || `Download failed (${res.status})`); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'SKILL.md'; a.click(); URL.revokeObjectURL(url);
      toast('SKILL.md downloaded');
    } catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(''); }
  };

  if (loading) return <Spinner label="Loading Natively status…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;

  const failures = apps.flatMap((a) => (syncsByApp[a.id] || []).filter((s) => s.error || s.status === 'failed').map((s) => ({ app: a, sync: s })));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Natively</h1>
      <p className="text-sm text-gray-600">InterviewHub generates a <code className="rounded bg-gray-100 px-1">SKILL.md</code> per application for the Natively app. Naming convention: <code className="rounded bg-gray-100 px-1">interview-{'{candidate}'}-{'{company}'}-{'{role}'}</code> (slugified, lower-case).</p>

      <Card>
        <h2 className="font-semibold">Manual activation instructions</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-700">
          <li>Generate the skill below (or from the application page) — the file is written to the skills directory on this machine (default: <code className="rounded bg-gray-100 px-1">data/skills/</code>, or <code className="rounded bg-gray-100 px-1">SKILLS_DIR</code> if set).</li>
          <li>In Natively, open Skills and add / point it at that <code className="rounded bg-gray-100 px-1">interview-*.md</code> file (SKILL.md lives inside the generated skill file itself — the file <em>is</em> the SKILL.md, named <code className="rounded bg-gray-100 px-1">interview-….md</code>).</li>
          <li>Confirm inside Natively that the skill appears and loads — look for the skill name in Natively&apos;s skill list.</li>
        </ol>
        <p className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-800">⚠ A generated file is NOT proof Natively loaded it. InterviewHub only writes the file and records a &apos;synced&apos; row — it cannot see inside Natively. Verify in the Natively app before relying on it in an interview.</p>
      </Card>

      {failures.length > 0 ? (
        <Card>
          <h2 className="font-semibold text-red-700">Sync failures</h2>
          <ul className="mt-2 space-y-1 text-sm">{failures.map(({ app, sync }) => <li key={sync.id}>{app.company} — {app.title}: {sync.error || sync.status}</li>)}</ul>
        </Card>
      ) : null}

      <Card>
        <h2 className="font-semibold">Skill files on disk ({files.length})</h2>
        {files.length === 0 ? <p className="mt-2 text-sm text-gray-500">No interview skills generated yet.</p> : (
          <ul className="mt-2 space-y-1 text-sm">{files.map((f) => <li key={f.name} className="rounded border p-2"><span className="font-medium">{f.name}</span><span className="block text-xs text-gray-500">{f.path}</span></li>)}</ul>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold">Per-application sync</h2>
        {apps.length === 0 ? <EmptyState title="No applications" body="Create an application first, then generate its Natively skill." action={<Link href="/applications"><Button>Go to Applications</Button></Link>} /> : (
          <ul className="mt-3 space-y-3">
            {apps.map((a) => {
              const syncs = syncsByApp[a.id] || [];
              const latest = syncs[0];
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
                  <span>
                    <Link className="font-medium text-blue-600 hover:underline" href={`/applications/${a.id}`}>{a.company} — {a.title}</Link>
                    <span className="block text-xs text-gray-500">
                      {latest ? <>{latest.status === 'synced' ? <Badge tone="green">synced</Badge> : <Badge tone="red">{latest.status || 'failed'}</Badge>} {latest.skill_name} · {fmtDateTime(latest.last_synced)}{latest.error ? ` · ${latest.error}` : ''}</> : 'Never generated'}
                    </span>
                  </span>
                  <span className="flex gap-1.5">
                    <Button variant="secondary" onClick={() => generate(a.id)} disabled={busy === a.id}>{busy === a.id ? 'Generating…' : 'Generate'}</Button>
                    <Button variant="ghost" onClick={() => download(a.id)} disabled={busy === `dl-${a.id}` || !latest}>{busy === `dl-${a.id}` ? 'Downloading…' : 'Download'}</Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
