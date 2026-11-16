export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { handleError, ApiError } from '@/lib/errors';
import { uninstallSkill } from '@/lib/natively-install';

/**
 * POST /api/natively/uninstall { application_id }
 *
 * Removes ONLY the exact `<slug>` folder registered in skills_sync for
 * this application, and only when it is inside the verified Natively
 * Skills directory and its contents still match what InterviewHub wrote.
 * Unrelated Natively Skills are never touched.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const applicationId = body.application_id as string;
    if (!applicationId) throw new ApiError(400, 'application_id is required');
    const result = uninstallSkill(applicationId);
    return NextResponse.json(result);
  } catch (e) {
    return handleError(e);
  }
}
