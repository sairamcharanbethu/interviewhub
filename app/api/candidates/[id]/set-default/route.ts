export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get, run, now, transaction } from '@/lib/db';
import { handleError, notFound } from '@/lib/errors';
import { serializeCandidate } from '@/lib/serialize';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const row = get<Record<string, unknown>>(`SELECT * FROM candidates WHERE id = ? AND deleted_at IS NULL`, params.id);
    if (!row) throw notFound('Candidate not found');
    transaction(() => {
      run(`UPDATE candidates SET is_default = 0`);
      run(`UPDATE candidates SET is_default = 1, updated_at = ? WHERE id = ?`, now(), params.id);
    });
    const u = get<Record<string, unknown>>(`SELECT * FROM candidates WHERE id = ?`, params.id)!;
    return NextResponse.json({ candidate: serializeCandidate(u) });
  } catch (e) { return handleError(e); }
}
