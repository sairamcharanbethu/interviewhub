'use client';
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiGet } from '@/lib/api';
import type { Candidate, Application } from '@/lib/types';

export const PREP_IN_PROGRESS_KEY = 'ih-prep-in-progress';

interface Ctx {
  candidates: Candidate[];
  applications: Application[]; // for selected candidate
  candidateId: string | null;
  applicationId: string | null;
  setCandidateId: (id: string | null) => void;
  setApplicationId: (id: string | null) => void;
  refreshCandidates: () => Promise<void>;
  refreshApplications: () => Promise<void>;
  toast: (msg: string, kind?: 'ok' | 'err') => void;
  toasts: { id: number; msg: string; kind: 'ok' | 'err' }[];
  dismissToast: (id: number) => void;
  prepInProgress: boolean;
  setPrepInProgress: (v: boolean) => void;
}
const Context = createContext<Ctx | null>(null);
export function useApp() {
  const c = useContext(Context);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

let toastId = 0;
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [candidateId, setCandidateIdState] = useState<string | null>(null);
  const [applicationId, setApplicationIdState] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Ctx['toasts']>([]);
  const [prepInProgress, setPrepInProgressState] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const toast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const refreshCandidates = useCallback(async () => {
    try {
      const d = await apiGet<{ candidates: Candidate[] }>('/api/candidates');
      setCandidates(d.candidates);
    } catch { /* header selectors degrade silently; pages show their own errors */ }
  }, []);
  const refreshApplications = useCallback(async () => {
    if (!candidateId) { setApplications([]); return; }
    try {
      const d = await apiGet<{ applications: Application[] }>(`/api/applications?candidate_id=${encodeURIComponent(candidateId)}`);
      setApplications(d.applications);
    } catch { setApplications([]); }
  }, [candidateId]);

  // Hydrate persisted selection once.
  useEffect(() => {
    try {
      setCandidateIdState(localStorage.getItem('ih-candidate-id') || null);
      setApplicationIdState(localStorage.getItem('ih-application-id') || null);
      setPrepInProgressState(localStorage.getItem(PREP_IN_PROGRESS_KEY) === '1');
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);
  useEffect(() => { refreshCandidates(); }, [refreshCandidates]);
  useEffect(() => { if (hydrated) refreshApplications(); }, [hydrated, refreshApplications]);

  // Keep stored selection valid once candidates load.
  useEffect(() => {
    if (!hydrated || !candidates.length) return;
    if (candidateId && !candidates.some((c) => c.id === candidateId)) {
      setCandidateIdState(null); setApplicationIdState(null);
      try { localStorage.removeItem('ih-candidate-id'); localStorage.removeItem('ih-application-id'); } catch { /* ignore */ }
    } else if (!candidateId) {
      const def = candidates.find((c) => c.is_default) || candidates[0];
      if (def) {
        setCandidateIdState(def.id);
        try { localStorage.setItem('ih-candidate-id', def.id); } catch { /* ignore */ }
      }
    }
  }, [candidates, hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  const setCandidateId = useCallback((id: string | null) => {
    setCandidateIdState(id); setApplicationIdState(null);
    try {
      if (id) localStorage.setItem('ih-candidate-id', id); else localStorage.removeItem('ih-candidate-id');
      localStorage.removeItem('ih-application-id');
    } catch { /* ignore */ }
  }, []);
  const setApplicationId = useCallback((id: string | null) => {
    setApplicationIdState(id);
    try {
      if (id) localStorage.setItem('ih-application-id', id); else localStorage.removeItem('ih-application-id');
    } catch { /* ignore */ }
  }, []);
  const setPrepInProgress = useCallback((v: boolean) => {
    setPrepInProgressState(v);
    try { localStorage.setItem(PREP_IN_PROGRESS_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  }, []);

  return (
    <Context.Provider value={{ candidates, applications, candidateId, applicationId, setCandidateId, setApplicationId, refreshCandidates, refreshApplications, toast, toasts, dismissToast, prepInProgress, setPrepInProgress }}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <button key={t.id} onClick={() => dismissToast(t.id)} className={`rounded-lg px-4 py-3 text-left text-sm shadow-lg ${t.kind === 'err' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'}`} role="status">
            {t.msg}
          </button>
        ))}
      </div>
    </Context.Provider>
  );
}
