export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get, run, transaction } from '@/lib/db';
import { handleError, notFound } from '@/lib/errors';
import { serializeResume } from '@/lib/serialize';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const row = get<Record<string, unknown>>(`SELECT * FROM resumes WHERE id = ?`, params.id);
    if (!row) throw notFound('Resume not found');
    transaction(() => {
      run(`UPDATE resumes SET is_active = 0 WHERE candidate_id = ?`, row.candidate_id);
      run(`UPDATE resumes SET is_active = 1 WHERE id = ?`, params.id);
    });
    const u = get<Record<string, unknown>>(`SELECT * FROM resumes WHERE id = ?`, params.id)!;
    return NextResponse.json({ resume: serializeResume(u) });
  } catch (e) { return handleError(e); }
}
