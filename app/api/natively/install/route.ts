export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { handleError, ApiError } from '@/lib/errors';
import { installSkill, InstallNeedsConfirmation } from '@/lib/natively-install';

/**
 * POST /api/natively/install { application_id, resume_id?, confirm_overwrite?, confirm_directory? }
 *
 * Installs (or updates) the application's Skill into the verified Natively
 * Skills directory as `<dir>/<slug>/SKILL.md`. Returns 409 with
 * needs_confirmation / needs_directory_confirmation when the UI must ask
 * the user first. 'installed' means the file was written to the verified
 * directory — never that Natively loaded or activated it.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const applicationId = body.application_id as string;
    if (!applicationId) throw new ApiError(400, 'application_id is required');
    const result = installSkill(applicationId, {
      explicitResumeId: (body.resume_id as string) || null,
      confirm_overwrite: body.confirm_overwrite === true,
      confirm_directory: body.confirm_directory === true,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof InstallNeedsConfirmation) {
      return NextResponse.json(
        { error: e.message, ...e.payload },
        { status: e.status },
      );
    }
    return handleError(e);
  }
}
