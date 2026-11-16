export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get, run, now } from '@/lib/db';
import { handleError, ApiError, notFound } from '@/lib/errors';
import { getLatestSync } from '@/lib/natively';

/**
 * POST /api/natively/confirm { application_id, action }
 * action: 'imported' | 'activated' | 'outdated' | 'awaiting_import'
 *
 * Manual confirmation ONLY — nothing in the app can observe Natively, so
 * 'imported' and 'activation_verified' are set exclusively here, by the
 * user, after they complete the steps inside Natively.
 * Transitions: file_written/awaiting_import -> imported -> activation_verified.
 * 'outdated' may be set from any generated state.
 */
const ALLOWED: Record<string, string[]> = {
  awaiting_import: ['file_written', 'generated'],
  imported: ['file_written', 'awaiting_import', 'generated'],
  // Action name is 'activated'; stored status is 'activation_verified'.
  activated: ['imported'],
  outdated: ['file_written', 'awaiting_import', 'imported', 'activation_verified', 'generated', 'outdated'],
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const applicationId = body.application_id as string;
    const action = body.action as string;
    if (!applicationId) throw new ApiError(400, 'application_id is required');
    if (!ALLOWED[action]) throw new ApiError(400, `Unknown action: ${action}`);
    const sync = getLatestSync(applicationId);
    if (!sync) throw notFound('No Skill generated for this application yet');
    const current = (sync.status as string) || 'file_written';
    if (!ALLOWED[action].includes(current)) {
      throw new ApiError(
        409,
        `Cannot mark '${action}' from status '${current}'. Import first, then confirm activation.`,
      );
    }
    const target = action === 'activated' ? 'activation_verified' : action;
    run(`UPDATE skills_sync SET status = ?, last_synced = ? WHERE id = ?`, target, now(), sync.id);
    const updated = get<Record<string, unknown>>(`SELECT * FROM skills_sync WHERE id = ?`, sync.id)!;
    return NextResponse.json({ sync: updated, status: target });
  } catch (e) { return handleError(e); }
}
