'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, apiPost } from '@/lib/api';
import { useApp } from '@/components/context';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, Spinner } from '@/components/ui';
import type { Application, SkillSync } from '@/lib/types';
import { errMsg, fmtDateTime } from '@/lib/types';

interface SkillFile { name: string; path: string }

type SyncRow = SkillSync & {
  resume_version?: number | null;
  jd_hash?: string | null;
};

interface InstallInfo {
  status?: string | null;
  slug?: string | null;
  skill_path?: string | null;
  installed_at?: string | null;
  slash_command?: string | null;
  update_available?: boolean;
  install_error?: string | null;
}

interface NativelyDirInfo {
  configured: boolean;
  resolved_path: string | null;
  source: string;
  verified: boolean;
  natively_detected: boolean;
  error: string | null;
}

const STATUS_TONE: Record<string, 'green' | 'blue' | 'amber' | 'red' | 'gray'> = {
  file_written: 'blue',
  awaiting_import: 'amber',
  imported: 'green',
  activation_verified: 'green',
  outdated: 'red',
  failed: 'red',
  generated: 'gray',
  installed: 'green',
  update_available: 'amber',
  installation_failed: 'red',
  uninstalled: 'gray',
};

export default function NativelyPage() {
  const { toast, candidateId } = useApp();
  const [apps, setApps] = useState<Application[]>([]);
  const [files, setFiles] = useState<SkillFile[]>([]);
  const [outputDir, setOutputDir] = useState('');
  const [syncsByApp, setSyncsByApp] = useState<Record<string, SyncRow[]>>({});
  const [outdatedByApp, setOutdatedByApp] = useState<Record<string, boolean>>({});
  const [installByApp, setInstallByApp] = useState<Record<string, InstallInfo | null>>({});
  const [installCfg, setInstallCfg] = useState<NativelyDirInfo | null>(null);
  const [dirConfirm, setDirConfirm] = useState<{ appId: string; resolved_path: string; message: string } | null>(null);
  const [dirConfirmed, setDirConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [budget, setBudget] = useState('');
  const [budgetDefault, setBudgetDefault] = useState(12000);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [a, f, s, cfg] = await Promise.all([
        apiGet<{ applications: Application[] }>(`/api/applications?include_archived=true${candidateId ? `&candidate_id=${encodeURIComponent(candidateId)}` : ''}`),
        apiGet<{ skills: SkillFile[]; output_dir: string }>('/api/natively/status'),
        apiGet<{ skill_context_chars: number; default: number }>('/api/natively/settings'),
        apiGet<NativelyDirInfo>('/api/natively/install-config'),
      ]);
      setBudget(String(s.skill_context_chars)); setBudgetDefault(s.default);
      setInstallCfg(cfg);
      setApps(a.applications); setFiles(f.skills); setOutputDir(f.output_dir || '');
      const map: Record<string, SyncRow[]> = {};
      const outdated: Record<string, boolean> = {};
      const installs: Record<string, InstallInfo | null> = {};
      for (const app of a.applications) {
        const s = await apiGet<{ syncs: SyncRow[]; outdated: boolean; install?: InstallInfo | null }>(`/api/natively/status?application_id=${encodeURIComponent(app.id)}`);
        map[app.id] = s.syncs;
        outdated[app.id] = Boolean(s.outdated);
        installs[app.id] = s.install || null;
      }
      setSyncsByApp(map); setOutdatedByApp(outdated); setInstallByApp(installs);
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [candidateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async (appId: string) => {
    setBusy(appId);
    try {
      const res = await fetch('/api/natively/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ application_id: appId, confirm_overwrite: true }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Generate failed (${res.status})`);
      toast(`Skill written: ${(data as { skill_name: string }).skill_name}`); await load();
    } catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(''); }
  };
  const saveBudget = async () => {
    setBusy('budget');
    try {
      const r = await apiPost<{ skill_context_chars: number }>('/api/natively/settings', { skill_context_chars: Number(budget) });
      setBudget(String(r.skill_context_chars)); toast(`Skill context budget set to ${r.skill_context_chars} characters`);
    } catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(''); }
  };
  const install = async (appId: string, confirmOverwrite = false, confirmDirectory = false) => {
    setBusy(`install-${appId}`);
    try {
      const res = await fetch('/api/natively/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ application_id: appId, confirm_overwrite: confirmOverwrite, confirm_directory: confirmDirectory }) });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        if (res.status === 409 && data.needs_directory_confirmation) {
          setDirConfirm({ appId, resolved_path: String(data.resolved_path || ''), message: String(data.error || 'Directory could not be verified.') });
          return;
        }
        if (res.status === 409 && data.needs_confirmation) {
          if (window.confirm(`A Skill folder '${String(data.slug || '')}' already exists in Natively's Skills directory and is not registered to this application. Install anyway? The existing folder will be moved aside as a backup, not deleted.`)) {
            await install(appId, true, confirmDirectory);
          }
          return;
        }
        throw new Error(String(data.error || `Install failed (${res.status})`));
      }
      toast(`Installed to Natively: ${String(data.slash_command || '')} — bring Natively to the front so it re-reads its Skills folder.`);
      setDirConfirm(null); setDirConfirmed(false); await load();
    } catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(''); }
  };
  const uninstall = async (appId: string) => {
    if (!window.confirm('Uninstall this Skill from Natively? Only this application\'s installed Skill folder is removed; unrelated Natively Skills and the manual-export file are untouched.')) return;
    setBusy(`uninstall-${appId}`);
    try {
      const r = await apiPost<{ status: string; already_gone?: boolean }>('/api/natively/uninstall', { application_id: appId });
      toast(r.already_gone ? 'Skill folder was already gone — marked uninstalled' : 'Skill uninstalled from Natively');
      await load();
    } catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(''); }
  };
  const confirm = async (appId: string, action: 'imported' | 'activated') => {
    setBusy(`${action}-${appId}`);
    try {
      const r = await apiPost<{ status: string }>('/api/natively/confirm', { application_id: appId, action });
      toast(`Skill status: ${r.status}`); await load();
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
        <p className="mt-1 text-sm text-gray-600">Output directory: <code className="rounded bg-gray-100 px-1">{outputDir || 'data/skills/'}</code> (override with <code className="rounded bg-gray-100 px-1">SKILLS_DIR</code>). Each Skill is one standalone <code className="rounded bg-gray-100 px-1">interview-*.md</code> file — the file <em>is</em> the SKILL.md content.</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-700">
          <li>Open Natively.</li>
          <li>Navigate to Skills.</li>
          <li>Add or point Natively to the generated interview Skill file.</li>
          <li>Select the generated interview-*.md file.</li>
          <li>Confirm that the Skill appears in Natively’s Skills list.</li>
          <li>Activate the Skill.</li>
          <li>Test it with an interview question.</li>
        </ol>
        <p className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-800">⚠ A generated file is NOT proof Natively loaded it. InterviewHub only writes the file — import and activation are recorded only when you click “Mark as imported” / “Mark activation verified” after completing the steps in Natively. No automatic discovery or activation is assumed. Skills work without Natively Pro’s Reference Files feature.</p>
      </Card>

      <Card>
        <h2 className="font-semibold">Automatic install to Natively</h2>
        {installCfg ? (
          <div className="mt-2 space-y-1 text-sm text-gray-700">
            <p>Skills directory: {installCfg.resolved_path ? <code className="rounded bg-gray-100 px-1">{installCfg.resolved_path}</code> : 'not configured'} <Badge tone={installCfg.verified ? 'green' : installCfg.configured ? 'amber' : 'red'}>{installCfg.verified ? 'verified' : installCfg.configured ? 'unverified' : 'unconfigured'}</Badge></p>
            <p className="text-gray-500">Source: {installCfg.source}{installCfg.natively_detected ? ' · Natively detected on this machine' : ''} — set <code className="rounded bg-gray-100 px-1">NATIVELY_SKILLS_DIR</code> to override (macOS default: ~/Library/Application Support/Natively/skills).</p>
            {installCfg.error ? <p className="text-amber-700">{installCfg.error}</p> : null}
            <p className="text-gray-600">Install writes <code className="rounded bg-gray-100 px-1">&lt;dir&gt;/&lt;slug&gt;/SKILL.md</code> atomically and only ever touches the one folder registered to each application. “Installed” means the file was written to this directory — not that Natively loaded it. After installing, bring Natively to the front; it re-reads the Skills folder when its window regains focus.</p>
          </div>
        ) : <p className="mt-2 text-sm text-gray-500">Loading install configuration…</p>}
      </Card>

      {failures.length > 0 ? (
        <Card>
          <h2 className="font-semibold text-red-700">Sync failures</h2>
          <ul className="mt-2 space-y-1 text-sm">{failures.map(({ app, sync }) => <li key={sync.id}>{app.company} — {app.title}: {sync.error || sync.status}</li>)}</ul>
        </Card>
      ) : null}

      <Card>
        <h2 className="font-semibold">Skill context budget</h2>
        <p className="mt-1 text-sm text-gray-600">Total characters of resume + JD excerpt included in a generated Skill (RAG picks the most relevant sections first; anything omitted is reported in the file). Default {budgetDefault}.</p>
        <div className="mt-3 flex max-w-md items-end gap-2">
          <Field label="Characters (1,000 – 200,000)"><Input type="number" min={1000} max={200000} step={1000} value={budget} onChange={(e) => setBudget(e.target.value)} /></Field>
          <Button variant="secondary" onClick={saveBudget} disabled={busy === 'budget'}>{busy === 'budget' ? 'Saving…' : 'Save budget'}</Button>
        </div>
      </Card>

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
              const outdated = outdatedByApp[a.id];
              const inst = installByApp[a.id];
              const installed = inst?.status === 'installed' || inst?.status === 'update_available';
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
                  <span>
                    <Link className="font-medium text-blue-600 hover:underline" href={`/applications/${a.id}`}>{a.company} — {a.title}</Link>
                    <span className="block text-xs text-gray-500">
                      {latest ? (
                        <>
                          <Badge tone={STATUS_TONE[latest.status || ''] || 'gray'}>{latest.status || 'unknown'}</Badge>
                          {outdated ? <span className="ml-1"><Badge tone="red">Outdated</Badge></span> : null}
                          {` ${latest.skill_name}.md · ${fmtDateTime(latest.last_synced)} · resume v${latest.resume_version ?? '—'}`}
                          {latest.error ? ` · ${latest.error}` : ''}
                        </>
                      ) : 'Never generated'}
                      {installed && inst?.slash_command ? <span className="block">Installed in Natively: <code className="rounded bg-gray-100 px-1">{inst.slash_command}</code>{inst.update_available ? ' · update available' : ''}</span> : null}
                      {inst?.status === 'installation_failed' ? <span className="block text-red-700">Installation failed: {inst.install_error || 'see details'}</span> : null}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    <Button variant="secondary" onClick={() => generate(a.id)} disabled={busy === a.id}>{busy === a.id ? 'Generating…' : 'Generate'}</Button>
                    <Button variant="ghost" onClick={() => download(a.id)} disabled={busy === `dl-${a.id}` || !latest}>{busy === `dl-${a.id}` ? 'Downloading…' : 'Download'}</Button>
                    <Button onClick={() => install(a.id)} disabled={busy === `install-${a.id}` || !installCfg?.resolved_path}>{busy === `install-${a.id}` ? 'Installing…' : installed ? 'Update in Natively' : 'Install to Natively'}</Button>
                    {installed ? <Button variant="danger" onClick={() => uninstall(a.id)} disabled={busy === `uninstall-${a.id}`}>Uninstall</Button> : null}
                    {latest && latest.status !== 'imported' && latest.status !== 'activation_verified' ? (
                      <Button variant="ghost" onClick={() => confirm(a.id, 'imported')} disabled={busy === `imported-${a.id}`}>Mark imported</Button>
                    ) : null}
                    {latest && latest.status === 'imported' ? (
                      <Button variant="ghost" onClick={() => confirm(a.id, 'activated')} disabled={busy === `activated-${a.id}`}>Mark activation verified</Button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Modal open={!!dirConfirm} onClose={() => { setDirConfirm(null); setDirConfirmed(false); }} title="Confirm Natively Skills directory">
        <p className="text-sm text-gray-700">{dirConfirm?.message}</p>
        <p className="mt-2 break-all font-mono text-xs">{dirConfirm?.resolved_path}</p>
        <p className="mt-2 text-sm text-gray-600">Only confirm if you are sure this is Natively&apos;s Skills folder (macOS default: ~/Library/Application Support/Natively/skills). InterviewHub will create the folder if needed and install only this application&apos;s Skill folder inside it.</p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={dirConfirmed} onChange={(e) => setDirConfirmed(e.target.checked)} />
          I confirm this is Natively&apos;s Skills directory
        </label>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => dirConfirm && install(dirConfirm.appId, false, true)} disabled={!dirConfirmed || busy.startsWith('install-')}>Install to this directory</Button>
          <Button variant="secondary" onClick={() => { setDirConfirm(null); setDirConfirmed(false); }}>Cancel</Button>
        </div>
      </Modal>
    </div>
  );
}
