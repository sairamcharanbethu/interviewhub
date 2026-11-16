'use client';
import { useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import type { Application, Candidate } from '@/lib/types';

export interface ApplicationFormData {
  candidate_id: string; company: string; title: string; department: string | null;
  location: string | null; employment_type: string | null; job_url: string | null;
  application_date: string | null; status: string | null; interview_date: string | null;
  stage: string | null; company_notes: string | null; notes: string | null; selected_resume_id: string | null;
  jd_text?: string | null; jd_parsed?: Record<string, unknown> | null;
}
const STATUSES = ['', 'wishlist', 'applied', 'screening', 'interview', 'offer', 'rejected', 'withdrawn', 'hired'];

export interface ApplicationPrefill {
  company?: string | null; title?: string | null; location?: string | null;
  employment_type?: string | null; job_url?: string | null;
  jd_text?: string | null; jd_parsed?: Record<string, unknown> | null;
}

export default function ApplicationForm({ initial, prefill, prefillNote, candidates, onSubmit, onCancel, saving, lockCandidate }: {
  initial?: Application | null;
  /** Values inferred from a job posting — shown for review/edit, saved only on submit. */
  prefill?: ApplicationPrefill | null; prefillNote?: string | null;
  candidates: Candidate[]; onSubmit: (d: ApplicationFormData) => void; onCancel: () => void; saving: boolean; lockCandidate?: boolean;
}) {
  const [candidateId, setCandidateId] = useState(initial?.candidate_id || candidates.find((c) => c.is_default)?.id || candidates[0]?.id || '');
  const [company, setCompany] = useState(prefill?.company || initial?.company || '');
  const [title, setTitle] = useState(prefill?.title || initial?.title || '');
  const [department, setDepartment] = useState(initial?.department || '');
  const [location, setLocation] = useState(prefill?.location || initial?.location || '');
  const [employmentType, setEmploymentType] = useState(prefill?.employment_type || initial?.employment_type || '');
  const [jobUrl, setJobUrl] = useState(prefill?.job_url || initial?.job_url || '');
  const [appDate, setAppDate] = useState(initial?.application_date || '');
  const [status, setStatus] = useState(initial?.status || '');
  const [interviewDate, setInterviewDate] = useState(initial?.interview_date || '');
  const [stage, setStage] = useState(initial?.stage || '');
  const [companyNotes, setCompanyNotes] = useState(initial?.company_notes || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [err, setErr] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!candidateId) { setErr('Pick a candidate.'); return; }
    if (!company.trim() || !title.trim()) { setErr('Company and role title are required.'); return; }
    onSubmit({
      candidate_id: candidateId, company: company.trim(), title: title.trim(),
      department: department.trim() || null, location: location.trim() || null,
      employment_type: employmentType.trim() || null, job_url: jobUrl.trim() || null,
      application_date: appDate || null, status: status || null,
      interview_date: interviewDate || null, stage: stage.trim() || null,
      company_notes: companyNotes.trim() || null, notes: notes.trim() || null,
      selected_resume_id: initial?.selected_resume_id ?? null,
      ...(prefill?.jd_text != null ? { jd_text: prefill.jd_text, jd_parsed: prefill.jd_parsed ?? null } : {}),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      {prefillNote ? <p className="rounded bg-green-50 p-2 text-sm text-green-800" role="status">{prefillNote}</p> : null}
      {err ? <p className="rounded bg-red-50 p-2 text-sm text-red-700" role="alert">{err}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Candidate" required>
          <Select value={candidateId} onChange={(e) => setCandidateId(e.target.value)} disabled={lockCandidate || !!initial} required>
            <option value="">Select candidate…</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'No status'}</option>)}
          </Select>
        </Field>
        <Field label="Company" required hint={prefill?.company ? 'Filled from the job posting — check it' : undefined}><Input value={company} onChange={(e) => setCompany(e.target.value)} required /></Field>
        <Field label="Role title" required hint={prefill?.title ? 'Filled from the job posting — check it' : undefined}><Input value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
        <Field label="Department"><Input value={department} onChange={(e) => setDepartment(e.target.value)} /></Field>
        <Field label="Location" hint={prefill?.location ? 'Filled from the job posting — check it' : undefined}><Input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
        <Field label="Employment type" hint={prefill?.employment_type ? 'Filled from the job posting — check it' : undefined}><Input value={employmentType} onChange={(e) => setEmploymentType(e.target.value)} placeholder="Full-time, Contract…" /></Field>
        <Field label="Job URL" hint={prefill?.job_url ? 'Filled from the job posting — check it' : undefined}><Input type="url" value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} placeholder="https://…" /></Field>
        <Field label="Application date"><Input type="date" value={appDate} onChange={(e) => setAppDate(e.target.value)} /></Field>
        <Field label="Interview date"><Input type="datetime-local" value={interviewDate} onChange={(e) => setInterviewDate(e.target.value)} /></Field>
        <Field label="Stage"><Input value={stage} onChange={(e) => setStage(e.target.value)} placeholder="e.g. Phone screen" /></Field>
      </div>
      <Field label="Company notes"><Textarea rows={2} value={companyNotes} onChange={(e) => setCompanyNotes(e.target.value)} /></Field>
      <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Create application'}</Button>
      </div>
    </form>
  );
}
