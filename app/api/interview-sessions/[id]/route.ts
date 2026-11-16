export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get, run, now } from '@/lib/db';
import { sessionPatchSchema } from '@/lib/validation';
import { handleError, parseJsonBody, notFound, ApiError } from '@/lib/errors';
import { serializeSession } from '@/lib/serialize';

type Row = Record<string, unknown>;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const row = get<Row>(`SELECT * FROM interview_sessions WHERE id = ?`, params.id);
    if (!row) throw notFound('Interview session not found');
    return NextResponse.json({ interview_session: serializeSession(row) });
  } catch (e) { return handleError(e); }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await parseJsonBody(req, sessionPatchSchema);
    const row = get<Row>(`SELECT * FROM interview_sessions WHERE id = ?`, params.id);
    if (!row) throw notFound('Interview session not found');
    const sets: string[] = []; const vals: unknown[] = [];
    for (const k of ['title','notes'] as const) {
      if ((body as Record<string, unknown>)[k] !== undefined) { sets.push(`${k} = ?`); vals.push((body as Record<string, unknown>)[k] ?? null); }
    }
    for (const k of ['questions','answers'] as const) {
      if ((body as Record<string, unknown>)[k] !== undefined) { sets.push(`${k} = ?`); vals.push(JSON.stringify((body as Record<string, unknown>)[k] ?? [])); }
    }
    if (!sets.length) throw new ApiError(400, 'No fields to update');
    sets.push(`updated_at = ?`); vals.push(now());
    run(`UPDATE interview_sessions SET ${sets.join(', ')} WHERE id = ?`, ...vals, params.id);
    const u = get<Row>(`SELECT * FROM interview_sessions WHERE id = ?`, params.id)!;
    return NextResponse.json({ interview_session: serializeSession(u) });
  } catch (e) { return handleError(e); }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const row = get<Row>(`SELECT * FROM interview_sessions WHERE id = ?`, params.id);
    if (!row) throw notFound('Interview session not found');
    run(`DELETE FROM interview_sessions WHERE id = ?`, params.id);
    return NextResponse.json({ deleted: true });
  } catch (e) { return handleError(e); }
}
