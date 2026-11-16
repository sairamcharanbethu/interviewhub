'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useApp } from '@/components/context';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Modal, Spinner } from '@/components/ui';
import CandidateForm, { type CandidateFormData } from '@/components/CandidateForm';
import type { Application, Candidate, Resume, StarStory } from '@/lib/types';
import { errMsg, fmtDate, fmtDateTime } from '@/lib/types';

export default function CandidateDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { toast, refreshCandidates, setCandidateId } = useApp();
  const [c, setC] = useState<Candidate | null>(null);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [stories, setStories] = useState<StarStory[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [viewResume, setViewResume] = useState<Resume | null>(null);
  const [delResume, setDelResume] = useState<Resume | null>(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [cd, rs, st, ap] = await Promise.all([
        apiGet<{ candidate: Candidate }>(`/api/candidates/${id}`),
        apiGet<{ resumes: Resume[] }>(`/api/candidates/${id}/resumes`),
        apiGet<{ star_stories: StarStory[] }>(`/api/star-stories?candidate_id=${encodeURIComponent(id)}`),
        apiGet<{ applications: Application[] }>(`/api/applications?candidate_id=${encodeURIComponent(id)}&include_archived=true`),
      ]);
      setC(cd.candidate); setResumes(rs.resumes); setStories(st.star_stories); setApps(ap.applications);
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch(`/api/candidates/${id}/resumes`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Upload failed (${res.status})`);
      toast(`Resume v${(data as { resume: Resume }).resume.version} uploaded and set active`);
      await load();
    } catch (e) { toast(errMsg(e), 'err'); } finally { setUploading(false); }
  };
  const approveSkills = async (r: Resume) => {
    if (!c || !r.parsed?.skills?.length) return;
    setBusy(r.id);
    try {
      const merged = [...new Set([...(c.skills || []), ...(r.parsed.skills || [])])];
      const updated = await apiPatch<{ candidate: Candidate }>(`/api/candidates/${id}`, { skills: merged });
      setC(updated.candidate); toast(`Approved ${r.parsed.skills.length} parsed skills onto the profile`);
    } catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(''); }
  };

  if (loading) return <Spinner label="Loading candidate…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!c) return <EmptyState title="Candidate not found" action={<Button onClick={() => router.push('/candidates')}>Back to candidates</Button>} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/candidates" className="text-sm text-blue-600 hover:underline">← Candidates</Link>
          <h1 className="mt-1 text-2xl font-bold">{c.name} {c.is_default ? <Badge tone="green">Default</Badge> : null} {c.archived_at ? <Badge tone="amber">Archived</Badge> : null}</h1>
          <p className="text-gray-600">{c.headline || '—'}</p>
          <p className="text-sm text-gray-500">{[c.email, c.phone, c.location].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => { setCandidateId(c.id); toast('Selected in header'); }}>Select in header</Button>
          <Button onClick={() => setEditOpen(true)}>Edit profile</Button>
        </div>
      </div>

      {c.summary ? <Card><h2 className="font-semibold">Summary</h2><p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{c.summary}</p></Card> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Skills</h2>
          <div className="mt-2 flex flex-wrap gap-1">{(c.skills || []).length ? c.skills.map((s) => <Badge key={s} tone="blue">{s}</Badge>) : <p className="text-sm text-gray-500">No skills listed.</p>}</div>
          <h3 className="mt-4 font-semibold">Certifications</h3>
          <ul className="mt-1 list-disc pl-5 text-sm">{(c.certifications || []).length ? c.certifications.map((x) => <li key={x}>{x}</li>) : <li className="list-none text-gray-500">None listed.</li>}</ul>
          <h3 className="mt-4 font-semibold">Achievements</h3>
          <ul className="mt-1 list-disc pl-5 text-sm">{(c.achievements || []).length ? c.achievements.map((x) => <li key={x}>{x}</li>) : <li className="list-none text-gray-500">None listed.</li>}</ul>
        </Card>
        <Card>
          <h2 className="font-semibold">Employment</h2>
          {(c.employment || []).length ? <ul className="mt-2 space-y-2 text-sm">{c.employment.map((e, i) => <li key={i} className="rounded border p-2"><span className="font-medium">{String((e as Record<string, unknown>).title || (e as Record<string, unknown>).raw || 'Role')}</span>{(e as Record<string, unknown>).employer ? ` — ${String((e as Record<string, unknown>).employer)}` : ''}{(e as Record<string, unknown>).dates ? ` (${String((e as Record<string, unknown>).dates)})` : ''}</li>)}</ul> : <p className="mt-2 text-sm text-gray-500">No employment history.</p>}
          <h3 className="mt-4 font-semibold">Education</h3>
          <ul className="mt-1 list-disc pl-5 text-sm">{(c.education || []).length ? c.education.map((e, i) => <li key={i}>{String((e as Record<string, unknown>).raw || (e as Record<string, unknown>).institution || JSON.stringify(e))}</li>) : <li className="list-none text-gray-500">None listed.</li>}</ul>
          <h3 className="mt-4 font-semibold">Projects</h3>
          <ul className="mt-1 list-disc pl-5 text-sm">{(c.projects || []).length ? c.projects.map((p, i) => <li key={i}>{String((p as Record<string, unknown>).name || (p as Record<string, unknown>).raw || JSON.stringify(p))}</li>) : <li className="list-none text-gray-500">None listed.</li>}</ul>
          {c.notes ? <><h3 className="mt-4 font-semibold">Notes</h3><p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{c.notes}</p></> : null}
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Resume versions ({resumes.length})</h2>
          <label className="cursor-pointer rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
            {uploading ? 'Uploading…' : 'Upload resume'}
            <input type="file" accept=".pdf,.docx,.txt,.md" className="hidden" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
          </label>
        </div>
        <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) upload(f); }}
          className={`mt-3 rounded-lg border-2 border-dashed p-4 text-center text-sm ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 text-gray-500'}`}>
          Drag &amp; drop a PDF, DOCX, TXT or MD resume here (max 10 MB). The newest upload becomes the active version.
        </div>
        {resumes.length === 0 ? <p className="mt-3 text-sm text-gray-500">No resumes uploaded yet.</p> : (
          <ul className="mt-3 space-y-2">
            {resumes.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
                <span><span className="font-medium">v{r.version} — {r.filename}</span> <span className="text-gray-500">({r.size_bytes ? `${Math.round(r.size_bytes / 1024)} KB · ` : ''}{fmtDateTime(r.created_at)})</span> {r.is_active ? <Badge tone="green">Active</Badge> : null} {r.parsed?.extraction_quality != null ? <Badge tone="gray">Quality {r.parsed.extraction_quality}%</Badge> : null}</span>
                <span className="flex gap-1.5">
                  <Button variant="secondary" onClick={() => setViewResume(r)}>View text</Button>
                  {!r.is_active ? <Button variant="ghost" onClick={async () => { try { await apiPost(`/api/resumes/${r.id}/activate`); toast('Resume activated'); await load(); } catch (e) { toast(errMsg(e), 'err'); } }}>Activate</Button> : null}
                  <Button variant="danger" onClick={() => setDelResume(r)}>Delete</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">STAR stories ({stories.length})</h2>
          {stories.length === 0 ? <p className="mt-2 text-sm text-gray-500">No STAR stories for this candidate yet.</p> : (
            <ul className="mt-2 space-y-2 text-sm">{stories.map((s) => <li key={s.id} className="rounded border p-2"><Link className="font-medium text-blue-600 hover:underline" href="/star">{s.title}</Link> <Badge tone={s.verification_status === 'verified' ? 'green' : 'gray'}>{s.verification_status}</Badge></li>)}</ul>
          )}
          <Link href="/star" className="mt-3 inline-block text-sm text-blue-600 hover:underline">Manage STAR stories →</Link>
        </Card>
        <Card>
          <h2 className="font-semibold">Applications ({apps.length})</h2>
          {apps.length === 0 ? <p className="mt-2 text-sm text-gray-500">No applications for this candidate yet.</p> : (
            <ul className="mt-2 space-y-2 text-sm">{apps.map((a) => <li key={a.id} className="flex justify-between gap-2"><Link className="font-medium text-blue-600 hover:underline" href={`/applications/${a.id}`}>{a.company} — {a.title}</Link><span className="text-gray-500">{a.status || '—'}{a.archived_at ? ' · archived' : ''}</span></li>)}</ul>
          )}
          <Link href="/applications" className="mt-3 inline-block text-sm text-blue-600 hover:underline">Manage applications →</Link>
        </Card>
      </div>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Edit ${c.name}`} wide>
        <CandidateForm initial={c} saving={saving} onCancel={() => setEditOpen(false)} onSubmit={async (d: CandidateFormData) => {
          setSaving(true);
          try { const u = await apiPatch<{ candidate: Candidate }>(`/api/candidates/${id}`, d); setC(u.candidate); toast('Candidate updated'); setEditOpen(false); await refreshCandidates(); }
          catch (e) { toast(errMsg(e), 'err'); } finally { setSaving(false); }
        }} />
      </Modal>

      <Modal open={!!viewResume} onClose={() => setViewResume(null)} title={viewResume ? `${viewResume.filename} — extracted text` : ''} wide>
        {viewResume ? (
          <div className="space-y-4">
            {viewResume.parsed?.skills?.length ? (
              <div>
                <h3 className="font-semibold">Parsed skills</h3>
                <div className="mt-2 flex flex-wrap gap-1">{viewResume.parsed.skills.map((s) => <Badge key={s} tone="blue">{s}</Badge>)}</div>
                <Button variant="secondary" className="mt-3" disabled={busy === viewResume.id} onClick={() => approveSkills(viewResume)}>
                  {busy === viewResume.id ? 'Approving…' : 'Approve parsed skills onto profile'}
                </Button>
                <p className="mt-1 text-xs text-gray-500">Merges the parsed skills into this candidate&apos;s profile skills (no duplicates).</p>
              </div>
            ) : null}
            {viewResume.parsed?.certifications?.length ? <p className="text-sm"><span className="font-semibold">Parsed certifications:</span> {viewResume.parsed.certifications.join(', ')}</p> : null}
            <h3 className="font-semibold">Extracted text</h3>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border bg-gray-50 p-3 text-xs">{viewResume.extracted_text || 'No extracted text.'}</pre>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog open={!!delResume} onClose={() => setDelResume(null)} onConfirm={async () => { if (!delResume) return; try { await apiDelete(`/api/resumes/${delResume.id}`); toast('Resume deleted'); setDelResume(null); await load(); } catch (e) { toast(errMsg(e), 'err'); } }} title="Delete resume version" body={`Delete ${delResume?.filename} (v${delResume?.version})? The stored file and its search chunks are removed. This cannot be undone.`} confirmLabel="Delete resume" />
    </div>
  );
}
