'use client';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { Badge, Button, Card, ErrorBox, Spinner } from '@/components/ui';
import type { HealthData } from '@/lib/types';
import { errMsg, fmtDateTime } from '@/lib/types';

export default function HealthPage() {
  const [h, setH] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try { setH(await apiGet<HealthData>('/api/health')); }
    catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const recheck = async () => { setChecking(true); try { setH(await apiGet<HealthData>('/api/health')); } catch (e) { setError(errMsg(e)); } finally { setChecking(false); } };

  if (loading) return <Spinner label="Checking system health…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!h) return null;

  const rows: { label: string; ok: boolean; detail: string }[] = [
    { label: 'Database (SQLite)', ok: h.db === 'ok', detail: h.db === 'ok' ? 'Reachable — SELECT 1 succeeded' : 'Error — database check failed' },
    { label: 'Ollama', ok: h.ollama_reachable, detail: h.ollama_reachable ? 'Reachable at the configured base URL' : 'Not reachable — is Ollama running? Check AI Settings for the base URL.' },
    { label: 'OpenRouter', ok: h.openrouter_configured, detail: h.openrouter_configured ? 'API key configured' : 'No API key configured — set one in AI Settings to use cloud models.' },
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">System Health</h1>
        <Button variant="secondary" onClick={recheck} disabled={checking}>{checking ? 'Checking…' : 'Re-check now'}</Button>
      </div>
      <Card>
        <p className="flex items-center gap-2 text-lg">Overall status: {h.status === 'ok' ? <Badge tone="green">OK</Badge> : <Badge tone="red">Degraded</Badge>}</p>
        <p className="mt-1 text-sm text-gray-500">Checked {fmtDateTime(h.timestamp)}</p>
        <ul className="mt-4 space-y-3">
          {rows.map((r) => (
            <li key={r.label} className="flex items-start justify-between gap-3 rounded border p-3 text-sm">
              <span><span className="font-medium">{r.label}</span><span className="block text-gray-500">{r.detail}</span></span>
              {r.ok ? <Badge tone="green">OK</Badge> : <Badge tone="amber">Unavailable</Badge>}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="font-semibold">Build &amp; version</h2>
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-gray-500">App</dt><dd>InterviewHub 0.1.0</dd></div>
          <div className="flex justify-between"><dt className="text-gray-500">Stack</dt><dd>Next.js 14 App Router · React 18 · Tailwind · better-sqlite3</dd></div>
          <div className="flex justify-between"><dt className="text-gray-500">Data directory</dt><dd>DATA_DIR env or ./data (see Settings)</dd></div>
          <div className="flex justify-between"><dt className="text-gray-500">Health endpoint</dt><dd><a className="text-blue-600 hover:underline" href="/api/health">/api/health</a></dd></div>
        </dl>
      </Card>
    </div>
  );
}
