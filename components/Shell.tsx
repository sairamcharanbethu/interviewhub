'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useApp } from '@/components/context';

const NAV_PRIMARY = [
  { href: '/prepare', label: 'Prepare Interview' },
  { href: '/', label: 'Dashboard' },
];
const NAV_ADVANCED = [
  { href: '/candidates', label: 'Candidates' },
  { href: '/applications', label: 'Applications' },
  { href: '/prep', label: 'Interview Prep' },
  { href: '/star', label: 'STAR Stories' },
  { href: '/documents', label: 'Documents' },
  { href: '/ai-settings', label: 'AI Settings' },
  { href: '/natively', label: 'Natively' },
  { href: '/health', label: 'System Health' },
  { href: '/settings', label: 'Settings' },
];
const NAV = [...NAV_PRIMARY, ...NAV_ADVANCED];

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { candidates, applications, candidateId, applicationId, setCandidateId, setApplicationId, prepInProgress } = useApp();

  const changeCandidate = (id: string) => {
    if (prepInProgress && id && id !== candidateId) {
      if (!window.confirm('An interview prep session is in progress. Switching candidate will change the prep context — continue?')) return;
    }
    setCandidateId(id || null);
  };
  const changeApplication = (id: string) => {
    if (prepInProgress && id && id !== applicationId) {
      if (!window.confirm('An interview prep session is in progress. Switching application will change the prep context — continue?')) return;
    }
    setApplicationId(id || null);
  };

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-gray-200 bg-gray-50 md:flex" aria-label="Main navigation">
        <div className="border-b px-5 py-4">
          <Link href="/" className="text-xl font-bold text-gray-900">InterviewHub</Link>
          <p className="text-xs text-gray-500">Candidates · Resumes · Prep</p>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_PRIMARY.map((item) => {
            const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}
                className={`block rounded-lg px-3 py-2 text-sm font-medium ${active ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-200'}`}>
                {item.label}
              </Link>
            );
          })}
          <p className="px-3 pt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">Advanced</p>
          {NAV_ADVANCED.map((item) => {
            const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}
                className={`block rounded-lg px-3 py-2 text-sm font-medium ${active ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-200'}`}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-3 text-xs text-gray-500">Local-first · SQLite<br />Data stays on this machine.</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
        <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 md:px-6">
            <Link href="/" className="text-lg font-bold md:hidden">InterviewHub</Link>
            <nav className="flex flex-wrap gap-1 md:hidden" aria-label="Mobile navigation">
              {NAV.map((i) => (
                <Link key={i.href} href={i.href} className={`rounded px-2 py-1 text-xs ${pathname === i.href ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>{i.label}</Link>
              ))}
            </nav>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="hdr-candidate">Candidate</label>
              <select id="hdr-candidate" value={candidateId || ''} onChange={(e) => changeCandidate(e.target.value)}
                className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm" aria-label="Select candidate">
                <option value="">Select candidate…</option>
                {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_default ? ' (default)' : ''}</option>)}
              </select>
              <label className="sr-only" htmlFor="hdr-application">Application</label>
              <select id="hdr-application" value={applicationId || ''} onChange={(e) => changeApplication(e.target.value)}
                className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm" aria-label="Select application" disabled={!candidateId}>
                <option value="">Select application…</option>
                {applications.map((a) => <option key={a.id} value={a.id}>{a.company} — {a.title}</option>)}
              </select>
              {applicationId ? (
                <button onClick={() => router.push(`/applications/${applicationId}`)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">Open</button>
              ) : null}
            </div>
          </div>
          {prepInProgress ? (
            <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 md:px-6" role="alert">
              ⚠ An interview prep session is in progress. Switching candidate or application will change the prep context.
            </div>
          ) : null}
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6">{children}</main>
      </div>
    </div>
  );
}
