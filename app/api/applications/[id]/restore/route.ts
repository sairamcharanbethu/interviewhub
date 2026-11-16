export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get, run, now } from '@/lib/db';
import { handleError, notFound } from '@/lib/errors';
import { serializeApplication } from '@/lib/serialize';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const row = get<Record<string, unknown>>(`SELECT * FROM applications WHERE id = ?`, params.id);
    if (!row) throw notFound('Application not found');
    run(`UPDATE applications SET archived_at = NULL, deleted_at = NULL, updated_at = ? WHERE id = ?`, now(), params.id);
    const u = get<Record<string, unknown>>(`SELECT * FROM applications WHERE id = ?`, params.id)!;
    return NextResponse.json({ application: serializeApplication(u) });
  } catch (e) { return handleError(e); }
}
