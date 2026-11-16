'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useApp } from '@/components/context';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal, Spinner } from '@/components/ui';
import CandidateForm, { type CandidateFormData, type CandidatePrefill } from '@/components/CandidateForm';
import type { ParsedResume } from '@/lib/parse/resume';
import type { Candidate } from '@/lib/types';
import { errMsg, fmtDate } from '@/lib/types';

export default function CandidatesPage() {
  const { toast, refreshCandidates } = useApp();
  const [list, setList] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Candidate | null>(null);
  const [saving, setSaving] = useState(false);
  // Resume-first creation: parsed resume + the original file, held only until the user saves.
  const [parsing, setParsing] = useState(false);
  const [prefill, setPrefill] = useState<CandidatePrefill | null>(null);
  const [prefillNote, setPrefillNote] = useState('');
  const [autoFilled, setAutoFilled] = useState<string[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [formKey, setFormKey] = useState(0);
  const resumeInputRef = useRef<HTMLInputElement>(null);

  const closeForm = () => { setFormOpen(false); setEditing(null); setPrefill(null); setPrefillNote(''); setAutoFilled([]); setPendingFile(null); };

  const parseResumeFile = async (file: File) => {
    setParsing(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/candidates/parse-resume', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Could not read this resume (${res.status})`);
      const p = (data as { parsed: ParsedResume }).parsed;
      const filled: string[] = [];
      if (p.name) filled.push('name');
      if (p.emails?.length) filled.push('email');
      if (p.phones?.length) filled.push('phone');
      if (p.location) filled.push('location');
      if (p.headline) filled.push('headline');
      if (p.summary) filled.push('summary');
      if (p.total_experience_years != null) filled.push('exp');
      if (p.skills?.length) filled.push('skills');
      if (p.certifications?.length) filled.push('certs');
      if (p.employment?.length) filled.push('employment');
      if (p.education?.length) filled.push('education');
      setPrefill({
        name: p.name, email: p.emails?.[0] ?? null, phone: p.phones?.[0] ?? null,
        location: p.location, headline: p.headline, summary: p.summary,
        total_experience_years: p.total_experience_years,
        skills: p.skills || [], employment: p.employment || [], education: p.education || [],
        certifications: p.certifications || [],
      });
      setAutoFilled(filled);
      setPendingFile(file);
      setPrefillNote(`Filled from ${file.name} — check and edit before saving. Anything the resume did not state was left blank.`);
      setEditing(null); setFormKey((k) => k + 1); setFormOpen(true);
      if (!p.name) toast('Resume read, but no name was found — please enter the name.', 'err');
    } catch (e) { toast(errMsg(e), 'err'); } finally { setParsing(false); }
  };
  const [confirm, setConfirm] = useState<{ kind: 'archive' | 'delete' | 'permanent' | 'restore'; c: Candidate } | null>(null);
  const [busyId, setBusyId] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const d = await apiGet<{ candidates: Candidate[] }>(`/api/candidates?include_archived=${showArchived}&include_deleted=${showDeleted}`);
      setList(d.candidates);
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [showArchived, showDeleted]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((c) => [c.name, c.email, c.headline, c.location, (c.skills || []).join(' ')].join(' ').toLowerCase().includes(needle));
  }, [list, q]);

  const submit = async (data: CandidateFormData) => {
    setSaving(true);
    try {
      if (editing) {
        await apiPatch<{ candidate: Candidate }>(`/api/candidates/${editing.id}`, data);
        toast('Candidate updated');
      } else {
        const created = await apiPost<{ candidate: Candidate }>('/api/candidates', data);
        toast('Candidate created');
        // Resume-first flow: attach the same file the profile was filled from as v1.
        if (pendingFile) {
          try {
            const fd = new FormData(); fd.append('file', pendingFile);
            const res = await fetch(`/api/candidates/${created.candidate.id}/resumes`, { method: 'POST', body: fd });
            const rd = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error((rd as { error?: string }).error || `Resume attach failed (${res.status})`);
            toast(`Resume ${pendingFile.name} attached as v1`);
          } catch (e) { toast(`Candidate created, but the resume could not be attached: ${errMsg(e)}`, 'err'); }
        }
      }
      closeForm(); await load(); await refreshCandidates();
    } catch (e) { toast(errMsg(e), 'err'); } finally { setSaving(false); }
  };
  const act = async (kind: string, c: Candidate) => {
    setBusyId(c.id);
    try {
      if (kind === 'archive') await apiPost(`/api/candidates/${c.id}/archive`);
      else if (kind === 'restore') await apiPost(`/api/candidates/${c.id}/restore`);
      else if (kind === 'duplicate') await apiPost(`/api/candidates/${c.id}/duplicate`);
      else if (kind === 'set-default') await apiPost(`/api/candidates/${c.id}/set-default`);
      else if (kind === 'delete') await apiDelete(`/api/candidates/${c.id}`);
      else if (kind === 'permanent') await apiDelete(`/api/candidates/${c.id}?permanent=true`);
      toast(kind === 'duplicate' ? 'Candidate duplicated' : kind === 'set-default' ? 'Default candidate set' : kind === 'restore' ? 'Candidate restored' : kind === 'archive' ? 'Candidate archived' : 'Candidate deleted');
      await load(); await refreshCandidates();
    } catch (e) { toast(errMsg(e), 'err'); } finally { setBusyId(''); setConfirm(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Candidates</h1>
        <div className="flex flex-wrap gap-2">
          <input ref={resumeInputRef} type="file" accept=".pdf,.docx,.txt,.md" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) parseResumeFile(f); e.target.value = ''; }} />
          <Button variant="secondary" disabled={parsing} onClick={() => resumeInputRef.current?.click()}>
            {parsing ? 'Reading resume…' : '⬆ Create from resume'}
          </Button>
          <Button onClick={() => { setEditing(null); setPrefill(null); setFormOpen(true); }}>+ New candidate</Button>
        </div>
      </div>
      <p className="text-sm text-gray-500">Upload a resume and the profile is filled in for you — name, contact, headline, skills, employment, education and certifications, ready to check and edit. Or create a profile manually.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Input aria-label="Search candidates" placeholder="Search name, email, headline, skill…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} /> Show deleted</label>
        <span className="text-sm text-gray-500">{filtered.length} of {list.length}</span>
      </div>
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={load} /> : filtered.length === 0 ? (
        <EmptyState title="No candidates found" body={q ? 'Try a different search.' : 'Create your first candidate profile to get started.'} action={<Button onClick={() => { setEditing(null); setFormOpen(true); }}>+ New candidate</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((c) => (
            <div key={c.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Link href={`/candidates/${c.id}`} className="text-lg font-semibold text-blue-600 hover:underline">{c.name}</Link>
                  <p className="text-sm text-gray-600">{c.headline || '—'}</p>
                  <p className="text-xs text-gray-500">{[c.email, c.location].filter(Boolean).join(' · ') || 'No contact info'}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {c.is_default ? <Badge tone="green">Default</Badge> : null}
                  {c.archived_at ? <Badge tone="amber">Archived</Badge> : null}
                  {c.deleted_at ? <Badge tone="red">Deleted</Badge> : null}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {(c.skills || []).slice(0, 6).map((s) => <Badge key={s}>{s}</Badge>)}
                {(c.skills || []).length > 6 ? <Badge tone="gray">+{(c.skills || []).length - 6} more</Badge> : null}
              </div>
              <p className="mt-2 text-xs text-gray-500">Updated {fmtDate(c.updated_at)}{c.total_experience_years != null ? ` · ${c.total_experience_years} yrs exp` : ''}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button variant="secondary" onClick={() => { setEditing(c); setFormOpen(true); }}>Edit</Button>
                {!c.is_default && !c.archived_at && !c.deleted_at ? <Button variant="ghost" disabled={busyId === c.id} onClick={() => act('set-default', c)}>Set default</Button> : null}
                <Button variant="ghost" disabled={busyId === c.id} onClick={() => act('duplicate', c)}>Duplicate</Button>
                {c.archived_at || c.deleted_at
                  ? <Button variant="ghost" disabled={busyId === c.id} onClick={() => setConfirm({ kind: 'restore', c })}>Restore</Button>
                  : <Button variant="ghost" disabled={busyId === c.id} onClick={() => setConfirm({ kind: 'archive', c })}>Archive</Button>}
                {!c.deleted_at ? <Button variant="ghost" disabled={busyId === c.id} onClick={() => setConfirm({ kind: 'delete', c })}>Delete</Button> : null}
                {c.deleted_at ? <Button variant="danger" disabled={busyId === c.id} onClick={() => setConfirm({ kind: 'permanent', c })}>Delete permanently</Button> : null}
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal open={formOpen} onClose={closeForm} title={editing ? `Edit ${editing.name}` : prefill ? 'New candidate — from resume' : 'New candidate'} wide>
        <CandidateForm key={formKey} initial={editing} prefill={prefill} prefillNote={prefillNote} autoFilled={autoFilled} onSubmit={submit} onCancel={closeForm} saving={saving} />
      </Modal>
      <ConfirmDialog
        open={!!confirm} onClose={() => setConfirm(null)}
        onConfirm={() => confirm && act(confirm.kind === 'restore' ? 'restore' : confirm.kind, confirm.c)}
        title={confirm?.kind === 'archive' ? 'Archive candidate' : confirm?.kind === 'restore' ? 'Restore candidate' : confirm?.kind === 'permanent' ? 'Permanently delete candidate' : 'Delete candidate'}
        body={confirm?.kind === 'archive' ? `${confirm.c.name} will be hidden from lists until restored. Applications and resumes are kept.` : confirm?.kind === 'restore' ? `Restore ${confirm.c.name}?` : confirm?.kind === 'permanent' ? `Permanently delete ${confirm.c.name} and all of their resumes, applications, STAR stories and sessions? This cannot be undone.` : `Soft-delete ${confirm?.c.name}? You can restore it later from the deleted list.`}
        confirmLabel={confirm?.kind === 'archive' ? 'Archive' : confirm?.kind === 'restore' ? 'Restore' : confirm?.kind === 'permanent' ? 'Delete permanently' : 'Delete'}
      />
    </div>
  );
}
