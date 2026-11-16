'use client';
import { useState } from 'react';
import { Button, Field, Input, Textarea } from '@/components/ui';
import type { Candidate } from '@/lib/types';
import { parseJsonLines, splitList, stringifyJson } from '@/lib/types';

export interface CandidateFormData {
  name: string; email: string | null; phone: string | null; location: string | null;
  headline: string | null; summary: string | null; total_experience_years: number | null;
  skills: string[]; employment: unknown[]; education: unknown[]; certifications: string[];
  projects: unknown[]; achievements: string[]; notes: string | null;
}

export default function CandidateForm({ initial, onSubmit, onCancel, saving }: {
  initial?: Candidate | null; onSubmit: (d: CandidateFormData) => void; onCancel: () => void; saving: boolean;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [email, setEmail] = useState(initial?.email || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const [location, setLocation] = useState(initial?.location || '');
  const [headline, setHeadline] = useState(initial?.headline || '');
  const [summary, setSummary] = useState(initial?.summary || '');
  const [exp, setExp] = useState(initial?.total_experience_years != null ? String(initial.total_experience_years) : '');
  const [skills, setSkills] = useState((initial?.skills || []).join(', '));
  const [certs, setCerts] = useState((initial?.certifications || []).join(', '));
  const [achievements, setAchievements] = useState((initial?.achievements || []).join('\n'));
  const [employment, setEmployment] = useState(stringifyJson(initial?.employment || []));
  const [education, setEducation] = useState(stringifyJson(initial?.education || []));
  const [projects, setProjects] = useState(stringifyJson(initial?.projects || []));
  const [notes, setNotes] = useState(initial?.notes || '');
  const [err, setErr] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr('Name is required.'); return; }
    let emp: unknown[], edu: unknown[], proj: unknown[];
    try { emp = parseJsonLines(employment); edu = parseJsonLines(education); proj = parseJsonLines(projects); }
    catch { setErr('Employment, education or projects is not valid JSON (or one item per line).'); return; }
    onSubmit({
      name: name.trim(), email: email.trim() || null, phone: phone.trim() || null,
      location: location.trim() || null, headline: headline.trim() || null, summary: summary.trim() || null,
      total_experience_years: exp.trim() ? Number(exp) : null,
      skills: splitList(skills), employment: emp, education: edu, certifications: splitList(certs),
      projects: proj, achievements: achievements.split('\n').map((s) => s.trim()).filter(Boolean),
      notes: notes.trim() || null,
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      {err ? <p className="rounded bg-red-50 p-2 text-sm text-red-700" role="alert">{err}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Location"><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City, Province" /></Field>
        <Field label="Headline"><Input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="e.g. Senior Oracle DBA" /></Field>
        <Field label="Total experience (years)"><Input type="number" min={0} max={80} step={0.5} value={exp} onChange={(e) => setExp(e.target.value)} /></Field>
      </div>
      <Field label="Summary"><Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
      <Field label="Skills" hint="Comma-separated, e.g. Oracle, PL/SQL, AWS"><Input value={skills} onChange={(e) => setSkills(e.target.value)} /></Field>
      <Field label="Certifications" hint="Comma-separated"><Input value={certs} onChange={(e) => setCerts(e.target.value)} /></Field>
      <Field label="Achievements" hint="One per line"><Textarea rows={3} value={achievements} onChange={(e) => setAchievements(e.target.value)} /></Field>
      <Field label="Employment" hint='JSON array, e.g. [{"employer":"DXC","title":"Software Engineer","dates":"2022–2026"}] — or one item per line'><Textarea rows={4} value={employment} onChange={(e) => setEmployment(e.target.value)} className="font-mono text-xs" /></Field>
      <Field label="Education" hint='JSON array, e.g. [{"institution":"NRI Institute of Technology","degree":"B.Tech"}]'><Textarea rows={3} value={education} onChange={(e) => setEducation(e.target.value)} className="font-mono text-xs" /></Field>
      <Field label="Projects" hint='JSON array, e.g. [{"name":"Cloud migration","description":"…"}]'><Textarea rows={3} value={projects} onChange={(e) => setProjects(e.target.value)} className="font-mono text-xs" /></Field>
      <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Create candidate'}</Button>
      </div>
    </form>
  );
}
