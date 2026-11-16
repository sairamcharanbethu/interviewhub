'use client';
import React, { useEffect, useRef, useState } from 'react';

export function Button({ children, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const cls = variant === 'primary'
    ? 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300'
    : variant === 'danger'
    ? 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300'
    : variant === 'ghost'
    ? 'bg-transparent text-gray-700 hover:bg-gray-100 disabled:text-gray-400'
    : 'bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 disabled:text-gray-400';
  return <button {...props} className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${cls} ${props.className || ''}`}>{children}</button>;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 ${props.className || ''}`} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${props.className || ''}`} />;
}
export function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${props.className || ''}`}>{children}</select>;
}
export function Field({ label, hint, children, required }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}{required ? ' *' : ''}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-gray-500">{hint}</span> : null}
    </label>
  );
}
export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${className}`}>{children}</div>;
}
export function Badge({ children, tone = 'gray' }: { children: React.ReactNode; tone?: 'gray' | 'green' | 'blue' | 'amber' | 'red' | 'purple' }) {
  const tones: Record<string, string> = {
    gray: 'bg-gray-100 text-gray-700', green: 'bg-green-100 text-green-800', blue: 'bg-blue-100 text-blue-800',
    amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-800', purple: 'bg-purple-100 text-purple-800',
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="flex items-center gap-2 py-8 text-sm text-gray-500" role="status"><span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" aria-hidden />{label}</div>;
}
export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {body ? <p className="mt-1 text-sm text-gray-500">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
export function ScoreBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const color = pct >= 75 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div>
      {label ? <div className="mb-1 flex justify-between text-sm"><span className="font-medium">{label}</span><span className="text-gray-600">{pct}%</span></div> : null}
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label || 'Score'}>
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
      <p className="font-medium">Something went wrong</p>
      <p className="mt-1">{error}</p>
      {onRetry ? <button onClick={onRetry} className="mt-2 font-medium underline">Retry</button> : null}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div ref={ref} className={`my-8 w-full rounded-xl bg-white shadow-xl ${wide ? 'max-w-3xl' : 'max-w-lg'}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close dialog" className="rounded px-2 py-1 text-xl leading-none text-gray-500 hover:bg-gray-100">×</button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = 'Delete', danger = true }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; body: string; confirmLabel?: string; danger?: boolean;
}) {
  const [typed, setTyped] = useState('');
  const needsType = confirmLabel.toLowerCase().includes('permanent');
  useEffect(() => { if (open) setTyped(''); }, [open ]);
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-gray-700">{body}</p>
      {needsType ? (
        <div className="mt-4">
          <Field label='Type DELETE to confirm permanent deletion' hint="This cannot be undone.">
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" aria-label="Type DELETE to confirm" />
          </Field>
        </div>
      ) : null}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={needsType && typed !== 'DELETE'}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}
