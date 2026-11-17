'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { Card, ErrorBox, Spinner } from '@/components/ui';
import { errMsg } from '@/lib/types';

export default function PrepareJobPage({ params }: { params: { jobId: string } }) {
  const [job, setJob] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const j = await apiGet<Record<string, unknown>>(`/api/prepare/${params.jobId}`);
        if (alive) setJob(j);
      } catch (e) { if (alive) setError(errMsg(e)); }
    };
    void load();
    const t = setInterval(() => {
      void load();
    }, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [params.jobId]);
  if (error) return <ErrorBox error={error} />;
  if (!job) return <Spinner label="Loading preparation job…" />;
  const done = job.status === 'completed' || job.status === 'partial' || job.status === 'failed';
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Prepare Interview — job {params.jobId}</h1>
      <Card>
        <p className="text-sm"><strong>Status:</strong> {String(job.status)} · {Number(job.progress ?? 0)}% — {String(job.currentStageLabel || job.currentStage || '')}</p>
        <div className="mt-3 h-2 w-full rounded bg-gray-200"><div className="h-2 rounded bg-blue-600" style={{ width: `${Number(job.progress ?? 0)}%` }} /></div>
        {done ? <p className="mt-3 text-sm"><Link className="text-blue-600 hover:underline" href="/prepare">Back to Prepare Interview →</Link>{job.applicationId ? <> · <Link className="text-blue-600 hover:underline" href={`/applications/${String(job.applicationId)}`}>View application →</Link></> : null}</p> : null}
      </Card>
    </div>
  );
}
