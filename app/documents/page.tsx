'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiDelete, apiGet } from '@/lib/api';
import { useApp } from '@/components/context';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Modal, Select, Spinner } from '@/components/ui';
import type { Candidate, Resume } from '@/lib/types';
import { errMsg, fmtDateTime } from '@/lib/types';

interface Row extends Resume { candidateName: string }

export default function DocumentsPage() {
  const { toast, candidateId, setCandidateId } = useApp();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<Row | null>(null);
  const [del, setDel] = useState<Row | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const c = await apiGet<{ candidates: Candidate[] }>('/api/candidates');
      setCandidates(c.candidates);
      const targets = candidateId ? c.candidates.filter((x) => x.id === candidateId) : c.candidates;
      const all: Row[] = [];
      for (const cand of targets) {
        const r = await apiGet<{ resumes: Resume[] }>(`/api/candidates/${cand.id}/resumes`);
        for (const res of r.resumes) all.push({ ...res, candidateName: cand.name });
      }
      all.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      setRows(all);
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [candidateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (file: File) => {
    if (!candidateId) { toast('Pick a candidate first — resumes belong to a candidate', 'err'); return; }
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch(`/api/candidates/${candidateId}/resumes`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Upload failed (${res.status})`);
      toast('Resume uploaded and set active'); await load();
    } catch (e) { toast(errMsg(e), 'err'); } finally { setUploading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Documents</h1>
        <label className="cursor-pointer rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700">
          {uploading ? 'Uploading…' : 'Upload resume'}
          <input type="file" accept=".pdf,.docx,.txt,.md" className="hidden" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
        </label>
      </div>
      <p className="text-sm text-gray-500">All resume versions across candidates. Uploads go to the candidate selected in the header (or the filter below).</p>
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Filter by candidate" value={candidateId || ''} onChange={(e) => setCandidateId(e.target.value || null)} className="w-auto">
          <option value="">All candidates</option>
          {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <span className="text-sm text-gray-500">{rows.length} documents</span>
      </div>
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={load} /> : rows.length === 0 ? (
        <EmptyState title="No documents yet" body="Upload a resume for a candidate to see it here." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50 text-left"><th className="px-4 py-2">File</th><th className="px-4 py-2">Candidate</th><th className="px-4 py-2">Version</th><th className="px-4 py-2">Uploaded</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Actions</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b align-top">
                  <td className="px-4 py-2 font-medium">{r.filename}<span className="block text-xs font-normal text-gray-500">{r.size_bytes ? `${Math.round(r.size_bytes / 1024)} KB · ` : ''}{r.mime || ''}</span></td>
                  <td className="px-4 py-2"><Link className="text-blue-600 hover:underline" href={`/candidates/${r.candidate_id}`}>{r.candidateName}</Link></td>
                  <td className="px-4 py-2">v{r.version}</td>
                  <td className="px-4 py-2">{fmtDateTime(r.created_at)}</td>
                  <td className="px-4 py-2">{r.is_active ? <Badge tone="green">Active</Badge> : <Badge>Superseded</Badge>}</td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1.5">
                      <Button variant="secondary" onClick={() => setView(r)}>Preview</Button>
                      {!r.is_active ? <Button variant="ghost" onClick={async () => { try { await fetch(`/api/resumes/${r.id}/activate`, { method: 'POST' }); toast('Resume activated'); await load(); } catch (e) { toast(errMsg(e), 'err'); } }}>Activate</Button> : null}
                      <Button variant="danger" onClick={() => setDel(r)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!view} onClose={() => setView(null)} title={view ? `${view.filename} — ${view.candidateName}` : ''} wide>
        {view ? (
          <div className="space-y-4">
            {view.parsed?.skills?.length ? <div><h3 className="font-semibold">Parsed skills</h3><div className="mt-2 flex flex-wrap gap-1">{view.parsed.skills.map((s) => <Badge key={s} tone="blue">{s}</Badge>)}</div></div> : null}
            <h3 className="font-semibold">Extracted text</h3>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border bg-gray-50 p-3 text-xs">{view.extracted_text || 'No extracted text.'}</pre>
          </div>
        ) : null}
      </Modal>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={async () => { if (!del) return; try { await apiDelete(`/api/resumes/${del.id}`); toast('Resume deleted'); setDel(null); await load(); } catch (e) { toast(errMsg(e), 'err'); } }}
        title="Delete resume" body={`Delete ${del?.filename} (v${del?.version}) for ${del?.candidateName}? The stored file and its search chunks are removed permanently.`} confirmLabel="Delete resume" />
    </div>
  );
}
