'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useApp } from '@/components/context';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Input, Modal, Select, Spinner, Textarea } from '@/components/ui';
import ApplicationForm, { type ApplicationFormData, type ApplicationPrefill } from '@/components/ApplicationForm';
import type { Application, Candidate } from '@/lib/types';
import { errMsg, fmtDate } from '@/lib/types';

export default function ApplicationsPage() {
  const router = useRouter();
  const { toast, candidateId, setApplicationId } = useApp();
  const [list, setList] = useState<Application[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<'newest' | 'company' | 'interview'>('newest');
  const [showArchived, setShowArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Application | null>(null);
  const [saving, setSaving] = useState(false);
  // JD-first creation: a job URL / pasted JD / JD file, parsed before the form opens.
  const [jdOpen, setJdOpen] = useState(false);
  const [jdUrl, setJdUrl] = useState('');
  const [jdTextInput, setJdTextInput] = useState('');
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [jdParsing, setJdParsing] = useState(false);
  const [jdError, setJdError] = useState('');
  const [jdPrefill, setJdPrefill] = useState<ApplicationPrefill | null>(null);
  const [jdPrefillNote, setJdPrefillNote] = useState('');
  const [formKey, setFormKey] = useState(0);
  const jdFileRef = useRef<HTMLInputElement>(null);

  const closeForm = () => { setFormOpen(false); setEditing(null); setJdPrefill(null); setJdPrefillNote(''); };

  const parseJd = async () => {
    setJdError(''); setJdParsing(true);
    try {
      let res: Response;
      if (jdFile) {
        const fd = new FormData(); fd.append('file', jdFile);
        res = await fetch('/api/applications/parse-jd', { method: 'POST', body: fd });
      } else if (jdUrl.trim()) {
        res = await fetch('/api/applications/parse-jd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_url: jdUrl.trim() }) });
      } else if (jdTextInput.trim()) {
        res = await fetch('/api/applications/parse-jd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jd_text: jdTextInput.trim() }) });
      } else { setJdError('Paste the job description, enter a job URL, or upload a JD file.'); return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Could not read this job posting (${res.status})`);
      const d = (data as { draft: { company: string | null; title: string | null; location: string | null; employment_type: string | null; job_url: string | null }; jd_text: string; parsed: Record<string, unknown> }).draft;
      const missing = [!d.company && 'company', !d.title && 'role title'].filter(Boolean) as string[];
      setJdPrefill({
        company: d.company, title: d.title, location: d.location, employment_type: d.employment_type,
        job_url: d.job_url || (jdUrl.trim() || null),
        jd_text: (data as { jd_text: string }).jd_text, jd_parsed: (data as { parsed: Record<string, unknown> }).parsed,
      });
      setJdPrefillNote(`Filled from the job posting — check and edit before saving.${missing.length ? ` The posting did not state a ${missing.join(' or ')} — please fill it in.` : ''}`);
      setJdOpen(false); setEditing(null); setFormKey((k) => k + 1); setFormOpen(true);
    } catch (e) { setJdError(errMsg(e)); } finally { setJdParsing(false); }
  };
  const [confirm, setConfirm] = useState<{ kind: 'archive' | 'restore' | 'delete' | 'permanent'; a: Application } | null>(null);
  const [busyId, setBusyId] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [a, c] = await Promise.all([
        apiGet<{ applications: Application[] }>(`/api/applications?include_archived=${showArchived}${candidateId ? `&candidate_id=${encodeURIComponent(candidateId)}` : ''}`),
        apiGet<{ candidates: Candidate[] }>('/api/candidates'),
      ]);
      setList(a.applications); setCandidates(c.candidates);
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [showArchived, candidateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const statuses = useMemo(() => [...new Set(list.map((a) => a.status || 'No status'))].sort(), [list]);
  const filtered = useMemo(() => {
    let out = list;
    const needle = q.trim().toLowerCase();
    if (needle) out = out.filter((a) => [a.company, a.title, a.location, a.department].join(' ').toLowerCase().includes(needle));
    if (status) out = out.filter((a) => (a.status || 'No status') === status);
    const sorted = [...out];
    if (sort === 'company') sorted.sort((x, y) => x.company.localeCompare(y.company));
    else if (sort === 'interview') sorted.sort((x, y) => String(x.interview_date || '9999').localeCompare(String(y.interview_date || '9999')));
    else sorted.sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
    return sorted;
  }, [list, q, status, sort]);

  const submit = async (data: ApplicationFormData) => {
    setSaving(true);
    try {
      if (editing) {
        const { candidate_id: _cid, ...patch } = data;
        await apiPatch(`/api/applications/${editing.id}`, patch);
        toast('Application updated');
        closeForm(); await load();
      } else {
        // JD-first creation lands on the detail page with the JD already
        // saved, so "Run match" is one click away. The manual flow stays
        // on the list, as before.
        const fromJd = !!jdPrefill;
        const created = await apiPost<{ application: Application }>('/api/applications', data);
        toast('Application created');
        closeForm(); await load();
        if (fromJd) router.push(`/applications/${created.application.id}`);
      }
    } catch (e) { toast(errMsg(e), 'err'); } finally { setSaving(false); }
  };
  const act = async (kind: string, a: Application) => {
    setBusyId(a.id);
    try {
      if (kind === 'archive') await apiPost(`/api/applications/${a.id}/archive`);
      else if (kind === 'restore') await apiPost(`/api/applications/${a.id}/restore`);
      else if (kind === 'duplicate') await apiPost(`/api/applications/${a.id}/duplicate`);
      else if (kind === 'delete') await apiDelete(`/api/applications/${a.id}`);
      else if (kind === 'permanent') await apiDelete(`/api/applications/${a.id}?permanent=true`);
      toast(kind === 'duplicate' ? 'Application duplicated' : kind === 'archive' ? 'Application archived' : kind === 'restore' ? 'Application restored' : 'Application deleted');
      await load();
    } catch (e) { toast(errMsg(e), 'err'); } finally { setBusyId(''); setConfirm(null); }
  };
  const candName = (id: string) => candidates.find((c) => c.id === id)?.name || id;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Applications</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { setJdError(''); setJdOpen(true); }}>🔗 Add from job link / JD</Button>
          <Button onClick={() => { setEditing(null); setJdPrefill(null); setFormOpen(true); }}>+ New application</Button>
        </div>
      </div>
      <p className="text-sm text-gray-500">Paste a job link or the job description text and the application is filled in for you — company, role, location and type, ready to check and edit. Some sites (notably LinkedIn) block automatic fetching, so pasting the text is the reliable fallback.</p>
      {candidateId ? <p className="text-sm text-gray-500">Filtered to the candidate selected in the header. Clear the header selector to see all.</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Input aria-label="Search applications" placeholder="Search company, title, location…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Select aria-label="Sort applications" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="w-auto">
          <option value="newest">Newest first</option>
          <option value="company">Company A–Z</option>
          <option value="interview">Interview date</option>
        </Select>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
        <span className="text-sm text-gray-500">{filtered.length} of {list.length}</span>
      </div>
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={load} /> : filtered.length === 0 ? (
        <EmptyState title="No applications found" body="Create your first application to track a role." action={<Button onClick={() => { setEditing(null); setFormOpen(true); }}>+ New application</Button>} />
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => (
            <div key={a.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link href={`/applications/${a.id}`} className="text-lg font-semibold text-blue-600 hover:underline">{a.company} — {a.title}</Link>
                  <p className="text-sm text-gray-600">{candName(a.candidate_id)}{a.location ? ` · ${a.location}` : ''}{a.interview_date ? ` · Interview ${fmtDate(a.interview_date)}` : ''}</p>
                </div>
                <div className="flex gap-1">
                  {a.status ? <Badge tone="blue">{a.status}</Badge> : <Badge>No status</Badge>}
                  {a.archived_at ? <Badge tone="amber">Archived</Badge> : null}
                  {!a.jd_text ? <Badge tone="red">No JD</Badge> : null}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button variant="secondary" onClick={() => { setApplicationId(a.id); }} >Select</Button>
                <Button variant="secondary" onClick={() => { setEditing(a); setFormOpen(true); }}>Edit</Button>
                <Button variant="ghost" disabled={busyId === a.id} onClick={() => act('duplicate', a)}>Duplicate</Button>
                {!a.archived_at ? <Button variant="ghost" disabled={busyId === a.id} onClick={() => setConfirm({ kind: 'archive', a })}>Archive</Button> : <Button variant="ghost" disabled={busyId === a.id} onClick={() => setConfirm({ kind: 'restore', a })}>Restore</Button>}
                <Button variant="ghost" disabled={busyId === a.id} onClick={() => setConfirm({ kind: 'delete', a })}>Delete</Button>
                <Button variant="danger" disabled={busyId === a.id} onClick={() => setConfirm({ kind: 'permanent', a })}>Delete permanently</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal open={jdOpen} onClose={() => setJdOpen(false)} title="Add from job link / JD" wide>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="jd-url">Job URL</label>
            <Input id="jd-url" type="url" placeholder="https://… (company career page, job board…)" value={jdUrl} onChange={(e) => setJdUrl(e.target.value)} />
            <p className="mt-1 text-xs text-gray-500">The posting is fetched and parsed. LinkedIn and other login-walled or JavaScript-only pages cannot be fetched — paste the text below instead.</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="jd-text">Or paste the job description</label>
            <Textarea id="jd-text" rows={8} placeholder="Paste the full job description here…" value={jdTextInput} onChange={(e) => setJdTextInput(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Or upload a JD file (PDF, DOCX, TXT, MD)</label>
            <input ref={jdFileRef} type="file" accept=".pdf,.docx,.txt,.md" onChange={(e) => { setJdFile(e.target.files?.[0] || null); }} />
            {jdFile ? <p className="mt-1 text-xs text-gray-500">Selected: {jdFile.name}</p> : null}
          </div>
          {jdError ? <p className="rounded bg-red-50 p-2 text-sm text-red-700" role="alert">{jdError}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setJdOpen(false)}>Cancel</Button>
            <Button disabled={jdParsing} onClick={parseJd}>{jdParsing ? 'Reading posting…' : 'Read posting & continue'}</Button>
          </div>
        </div>
      </Modal>
      <Modal open={formOpen} onClose={closeForm} title={editing ? `Edit ${editing.company} — ${editing.title}` : jdPrefill ? 'New application — from job posting' : 'New application'} wide>
        <ApplicationForm key={formKey} initial={editing} prefill={jdPrefill} prefillNote={jdPrefillNote} candidates={candidates} onSubmit={submit} onCancel={closeForm} saving={saving} />
      </Modal>
      <ConfirmDialog
        open={!!confirm} onClose={() => setConfirm(null)}
        onConfirm={() => confirm && act(confirm.kind, confirm.a)}
        title={confirm?.kind === 'archive' ? 'Archive application' : confirm?.kind === 'restore' ? 'Restore application' : confirm?.kind === 'permanent' ? 'Permanently delete application' : 'Delete application'}
        body={confirm?.kind === 'archive' ? `Archive ${confirm.a.company} — ${confirm.a.title}? It will be hidden until you show archived items; you can restore it from this page.` : confirm?.kind === 'restore' ? `Restore ${confirm.a.company} — ${confirm.a.title} from the archive?` : confirm?.kind === 'permanent' ? `Permanently delete ${confirm.a.company} — ${confirm.a.title} and its interview sessions? This cannot be undone.` : `Soft-delete ${confirm?.a.company} — ${confirm?.a.title}? It will be hidden from this list.`}
        confirmLabel={confirm?.kind === 'archive' ? 'Archive' : confirm?.kind === 'restore' ? 'Restore' : confirm?.kind === 'permanent' ? 'Delete permanently' : 'Delete'}
      />
    </div>
  );
}
