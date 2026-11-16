export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get, run, now } from '@/lib/db';
import { handleError, notFound } from '@/lib/errors';
import { serializeCandidate } from '@/lib/serialize';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const row = get<Record<string, unknown>>(`SELECT * FROM candidates WHERE id = ? AND deleted_at IS NULL`, params.id);
    if (!row) throw notFound('Candidate not found');
    run(`UPDATE candidates SET archived_at = ?, updated_at = ? WHERE id = ?`, now(), now(), params.id);
    const u = get<Record<string, unknown>>(`SELECT * FROM candidates WHERE id = ?`, params.id)!;
    return NextResponse.json({ candidate: serializeCandidate(u) });
  } catch (e) { return handleError(e); }
}
