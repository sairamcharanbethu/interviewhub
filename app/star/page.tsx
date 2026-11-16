'use client';
import { useEffect, useMemo, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useApp } from '@/components/context';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal, Select, Spinner, Textarea } from '@/components/ui';
import type { Candidate, StarStory } from '@/lib/types';
import { errMsg, fmtDate, splitList } from '@/lib/types';

interface FormData { title: string; situation: string; task: string; action: string; result: string; technologies: string; skills: string; employer: string; project: string; verification_status: string }

function emptyForm(): FormData { return { title: '', situation: '', task: '', action: '', result: '', technologies: '', skills: '', employer: '', project: '', verification_status: 'draft' }; }
function fromStory(s: StarStory): FormData { return { title: s.title, situation: s.situation || '', task: s.task || '', action: s.action || '', result: s.result || '', technologies: (s.technologies || []).join(', '), skills: (s.skills || []).join(', '), employer: s.employer || '', project: s.project || '', verification_status: s.verification_status || 'draft' }; }

export default function StarPage() {
  const { toast, candidateId, setCandidateId } = useApp();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [stories, setStories] = useState<StarStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [q, setQ] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StarStory | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [del, setDel] = useState<StarStory | null>(null);
  const [formError, setFormError] = useState('');
  const [roleHint, setRoleHint] = useState('');
  const [generating, setGenerating] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [draftInfo, setDraftInfo] = useState('');

  const loadCandidates = async () => {
    const c = await apiGet<{ candidates: Candidate[] }>('/api/candidates');
    setCandidates(c.candidates);
    if (!candidateId && c.candidates.length) setCandidateId(c.candidates.find((x) => x.is_default)?.id || c.candidates[0].id);
  };
  const loadStories = async () => {
    if (!candidateId) { setStories([]); return; }
    setLoading(true); setError('');
    try { const s = await apiGet<{ star_stories: StarStory[] }>(`/api/star-stories?candidate_id=${encodeURIComponent(candidateId)}`); setStories(s.star_stories); }
    catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  };
  useEffect(() => { loadCandidates(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadStories(); }, [candidateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    let out = stories;
    if (filterStatus) out = out.filter((s) => s.verification_status === filterStatus);
    const needle = q.trim().toLowerCase();
    if (needle) out = out.filter((s) => [s.title, s.situation, s.task, s.action, s.result, s.employer, s.project, (s.skills || []).join(' ')].join(' ').toLowerCase().includes(needle));
    return out;
  }, [stories, filterStatus, q]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { setFormError('Title is required.'); return; }
    if (!candidateId) { setFormError('Pick a candidate first.'); return; }
    setSaving(true); setFormError('');
    const body = { title: form.title.trim(), situation: form.situation.trim() || null, task: form.task.trim() || null, action: form.action.trim() || null, result: form.result.trim() || null, technologies: splitList(form.technologies), skills: splitList(form.skills), employer: form.employer.trim() || null, project: form.project.trim() || null, verification_status: form.verification_status };
    try {
      if (editing) await apiPatch(`/api/star-stories/${editing.id}`, body);
      else await apiPost('/api/star-stories', { candidate_id: candidateId, ...body });
      toast(editing ? 'STAR story updated' : 'STAR story created');
      setFormOpen(false); setEditing(null); await loadStories();
    } catch (err) { setFormError(errMsg(err)); } finally { setSaving(false); }
  };
  const markVerified = async (s: StarStory, v: string) => {
    try { await apiPatch(`/api/star-stories/${s.id}`, { verification_status: v }); toast(`Story marked ${v}`); await loadStories(); }
    catch (e) { toast(errMsg(e), 'err'); }
  };
  const generateDraft = async () => {
    if (!candidateId) { setDraftError('Pick a candidate first.'); return; }
    setGenerating(true); setDraftError(''); setDraftInfo('');
    try {
      const r = await apiPost<{ draft: { title: string; situation?: string | null; task?: string | null; action?: string | null; result?: string | null; technologies?: string[]; skills?: string[] } | null; verification_status: string; fallback?: boolean; ai_error?: string | null }>('/api/star-stories/generate-draft', { candidate_id: candidateId, role_hint: roleHint.trim() || undefined });
      if (!r.draft) {
        setDraftError(r.ai_error || 'No draft could be generated — upload a resume for this candidate first.');
        return;
      }
      // Drafts are never saved as verified: the form opens with status draft
      // and the user reviews/edits before creating the story.
      setEditing(null);
      setForm({
        title: r.draft.title || '', situation: r.draft.situation || '', task: r.draft.task || '',
        action: r.draft.action || '', result: r.draft.result || '',
        technologies: (r.draft.technologies || []).join(', '), skills: (r.draft.skills || []).join(', '),
        employer: '', project: '', verification_status: 'draft',
      });
      setFormOpen(true);
      setDraftInfo(r.fallback ? 'Draft generated from the offline fallback — review every claim before saving.' : 'AI draft ready — review every claim before saving.');
      toast('AI draft loaded into the form');
    } catch (e) { setDraftError(errMsg(e)); } finally { setGenerating(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">STAR Stories</h1>
        <Button onClick={() => { setEditing(null); setForm(emptyForm()); setFormOpen(true); }} disabled={!candidateId}>+ New STAR story</Button>
      </div>
      <p className="text-sm text-gray-500">Reusable, evidence-only stories for behavioural questions. Answers cite these stories — never invent metrics. Mark a story <strong>verified</strong> only after checking every claim against the resume or records.</p>
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <Field label="Role / theme hint for an AI draft" hint="Optional — e.g. 'Oracle RAC failover' or 'production incident'. The draft is built only from this candidate's resume evidence and opens as an unsaved draft for review.">
          <Input aria-label="Role or theme hint for AI draft" placeholder="e.g. Oracle Data Guard failover" value={roleHint} onChange={(e) => setRoleHint(e.target.value)} className="max-w-sm" />
        </Field>
        <Button variant="secondary" onClick={generateDraft} disabled={!candidateId || generating}>{generating ? 'Generating…' : 'Generate AI draft'}</Button>
      </div>
      {draftError ? <p className="rounded bg-red-50 p-3 text-sm text-red-700" role="alert">{draftError}</p> : null}
      {draftInfo ? <p className="rounded bg-green-50 p-3 text-sm text-green-800" role="status">{draftInfo}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Filter by candidate" value={candidateId || ''} onChange={(e) => setCandidateId(e.target.value || null)} className="w-auto">
          <option value="">Select candidate…</option>
          {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select aria-label="Filter by verification status" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-auto">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="verified">Verified</option>
        </Select>
        <Input aria-label="Search STAR stories" placeholder="Search title, text, skill…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <span className="text-sm text-gray-500">{filtered.length} stories</span>
      </div>
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={loadStories} /> : !candidateId ? (
        <EmptyState title="Pick a candidate" body="STAR stories belong to a candidate — select one above." />
      ) : filtered.length === 0 ? (
        <EmptyState title="No STAR stories yet" body="Create your first Situation–Task–Action–Result story." action={<Button onClick={() => { setEditing(null); setForm(emptyForm()); setFormOpen(true); }}>+ New STAR story</Button>} />
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => (
            <div key={s.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">{s.title}</h2>
                  <p className="text-xs text-gray-500">{[s.employer, s.project].filter(Boolean).join(' · ')}{s.employer || s.project ? ' · ' : ''}Created {fmtDate(s.created_at)}</p>
                </div>
                <Badge tone={s.verification_status === 'verified' ? 'green' : 'gray'}>{s.verification_status}</Badge>
              </div>
              <dl className="mt-3 space-y-2 text-sm">
                {([['Situation', s.situation], ['Task', s.task], ['Action', s.action], ['Result', s.result]] as const).map(([label, v]) => v ? <div key={label}><dt className="font-semibold">{label}</dt><dd className="whitespace-pre-wrap text-gray-700">{v}</dd></div> : null)}
              </dl>
              <div className="mt-2 flex flex-wrap gap-1">
                {(s.technologies || []).map((t) => <Badge key={t} tone="blue">{t}</Badge>)}
                {(s.skills || []).map((t) => <Badge key={t}>{t}</Badge>)}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button variant="secondary" onClick={() => { setEditing(s); setForm(fromStory(s)); setFormOpen(true); }}>Edit</Button>
                {s.verification_status !== 'verified' ? <Button variant="ghost" onClick={() => markVerified(s, 'verified')}>Mark verified</Button> : <Button variant="ghost" onClick={() => markVerified(s, 'draft')}>Back to draft</Button>}
                <Button variant="danger" onClick={() => setDel(s)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? `Edit: ${editing.title}` : 'New STAR story'} wide>
        <form onSubmit={submit} className="space-y-4">
          {formError ? <p className="rounded bg-red-50 p-2 text-sm text-red-700" role="alert">{formError}</p> : null}
          <Field label="Title" required><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Employer"><Input value={form.employer} onChange={(e) => setForm({ ...form, employer: e.target.value })} /></Field>
            <Field label="Project"><Input value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} /></Field>
          </div>
          <Field label="Situation"><Textarea rows={3} value={form.situation} onChange={(e) => setForm({ ...form, situation: e.target.value })} /></Field>
          <Field label="Task"><Textarea rows={2} value={form.task} onChange={(e) => setForm({ ...form, task: e.target.value })} /></Field>
          <Field label="Action"><Textarea rows={3} value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} /></Field>
          <Field label="Result" hint="Quantified where true — never invent numbers."><Textarea rows={2} value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Technologies" hint="Comma-separated"><Input value={form.technologies} onChange={(e) => setForm({ ...form, technologies: e.target.value })} /></Field>
            <Field label="Skills" hint="Comma-separated"><Input value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} /></Field>
          </div>
          <Field label="Verification status">
            <Select value={form.verification_status} onChange={(e) => setForm({ ...form, verification_status: e.target.value })}>
              <option value="draft">draft</option>
              <option value="verified">verified</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create story'}</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={async () => { if (!del) return; try { await apiDelete(`/api/star-stories/${del.id}`); toast('STAR story deleted'); setDel(null); await loadStories(); } catch (e) { toast(errMsg(e), 'err'); } }}
        title="Delete STAR story" body={`Delete “${del?.title}”? The API deletes it permanently — there is no archive endpoint for STAR stories, so this cannot be undone.`} confirmLabel="Delete permanently" />
    </div>
  );
}
