'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiDelete, apiGet } from '@/lib/api';
import { useApp } from '@/components/context';
import { Badge, Button, Card, ConfirmDialog, ErrorBox, Spinner } from '@/components/ui';
import type { Application, Candidate } from '@/lib/types';
import { errMsg } from '@/lib/types';

export default function SettingsPage() {
  const { toast, refreshCandidates } = useApp();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [confirm, setConfirm] = useState<{ kind: 'candidate' | 'application'; id: string; name: string } | null>(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [c, a] = await Promise.all([
        apiGet<{ candidates: Candidate[] }>('/api/candidates?include_deleted=true&include_archived=true'),
        apiGet<{ applications: Application[] }>('/api/applications?include_archived=true'),
      ]);
      setCandidates(c.candidates); setApps(a.applications);
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const exportBackup = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/backup/export', { method: 'POST' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as { error?: string }).error || `Export failed (${res.status})`); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `interviewhub-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
      toast('Backup downloaded (JSON — OpenRouter key is stripped by the API)');
    } catch (e) { toast(errMsg(e), 'err'); } finally { setExporting(false); }
  };
  const restore = async (file: File) => {
    setRestoring(true); setRestoreResult(''); setRestoreError('');
    try {
      const parsed = JSON.parse(await file.text()) as { tables?: Record<string, unknown[]> };
      if (!parsed.tables) throw new Error('Not a valid InterviewHub backup: missing "tables".');
      // The API accepts the ai_settings table on restore (non-secret fields
      // only — the OpenRouter key is stripped by export and dropped by the
      // API if present), so a straight export→restore round-trips as-is.
      const res = await fetch('/api/backup/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Restore failed (${res.status})`);
      const counts = (data as { counts?: Record<string, number> }).counts || {};
      setRestoreResult(`Restored: ${Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(', ') || 'nothing'}. AI settings (models, routing) are restored; the OpenRouter key is never in a backup — re-enter it in AI Settings if needed.`);
      toast('Backup restored'); await load(); await refreshCandidates();
    } catch (e) { setRestoreError(errMsg(e)); } finally { setRestoring(false); }
  };
  const permanentDelete = async () => {
    if (!confirm) return;
    try {
      if (confirm.kind === 'candidate') await apiDelete(`/api/candidates/${confirm.id}?permanent=true`);
      else await apiDelete(`/api/applications/${confirm.id}?permanent=true`);
      toast('Permanently deleted'); setConfirm(null); await load(); await refreshCandidates();
    } catch (e) { toast(errMsg(e), 'err'); }
  };

  if (loading) return <Spinner label="Loading settings…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Card>
        <h2 className="font-semibold">Data</h2>
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-gray-500">Data directory</dt><dd>DATA_DIR env var, or ./data next to the app (SQLite file interviewhub.db, uploads/ and skills/ inside it)</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-gray-500">Candidates</dt><dd>{candidates.length} ({candidates.filter((c) => c.deleted_at).length} deleted)</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-gray-500">Applications</dt><dd>{apps.length}</dd></div>
        </dl>
        <p className="mt-2 text-xs text-gray-500">The server reads DATA_DIR / SKILLS_DIR from its environment at startup; this page cannot change them — edit the server&apos;s .env and restart.</p>
      </Card>

      <Card>
        <h2 className="font-semibold">Backup</h2>
        <p className="mt-1 text-sm text-gray-600">Export downloads a JSON snapshot of all tables. The OpenRouter key is stripped from the export. Restore merges rows by id (INSERT OR REPLACE) and rebuilds full-text search.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={exportBackup} disabled={exporting}>{exporting ? 'Exporting…' : 'Download backup (JSON)'}</Button>
          <label className="cursor-pointer rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium hover:bg-gray-50">
            {restoring ? 'Restoring…' : 'Restore from backup file…'}
            <input type="file" accept=".json,application/json" className="hidden" disabled={restoring} onChange={(e) => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = ''; }} />
          </label>
        </div>
        {restoreResult ? <p className="mt-3 rounded bg-green-50 p-3 text-sm text-green-800" role="status">{restoreResult}</p> : null}
        {restoreError ? <p className="mt-3 rounded bg-red-50 p-3 text-sm text-red-800" role="alert">{restoreError}</p> : null}
      </Card>

      <Card>
        <h2 className="font-semibold text-red-700">Danger zone</h2>
        <p className="mt-1 text-sm text-gray-600">Permanent deletes go through the existing APIs and cannot be undone. Soft-deleted candidates appear here for permanent removal; applications are listed with their company/role.</p>
        <div className="mt-3 space-y-2">
          {candidates.filter((c) => c.deleted_at).length === 0 && apps.length === 0 ? <p className="text-sm text-gray-500">Nothing to permanently delete.</p> : null}
          {candidates.filter((c) => c.deleted_at).map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
              <span><Badge tone="red">Deleted candidate</Badge> {c.name}</span>
              <Button variant="danger" onClick={() => setConfirm({ kind: 'candidate', id: c.id, name: c.name })}>Delete permanently</Button>
            </div>
          ))}
          {apps.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
              <span><Badge tone="gray">Application</Badge> {a.company} — {a.title} <Link className="text-blue-600 hover:underline" href={`/applications/${a.id}`}>Open</Link></span>
              <Button variant="danger" onClick={() => setConfirm({ kind: 'application', id: a.id, name: `${a.company} — ${a.title}` })}>Delete permanently</Button>
            </div>
          ))}
        </div>
      </Card>

      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} onConfirm={permanentDelete}
        title="Permanently delete" body={`Permanently delete ${confirm?.name}? This cannot be undone.`} confirmLabel="Delete permanently" />
    </div>
  );
}
