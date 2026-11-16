'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useApp } from '@/components/context';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal, Spinner } from '@/components/ui';
import CandidateForm, { type CandidateFormData } from '@/components/CandidateForm';
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
        await apiPost<{ candidate: Candidate }>('/api/candidates', data);
        toast('Candidate created');
      }
      setFormOpen(false); setEditing(null); await load(); await refreshCandidates();
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
        <Button onClick={() => { setEditing(null); setFormOpen(true); }}>+ New candidate</Button>
      </div>
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
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? `Edit ${editing.name}` : 'New candidate'} wide>
        <CandidateForm initial={editing} onSubmit={submit} onCancel={() => setFormOpen(false)} saving={saving} />
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
