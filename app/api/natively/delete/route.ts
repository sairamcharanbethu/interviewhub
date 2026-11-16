export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { run } from '@/lib/db';
import { handleError, ApiError, notFound } from '@/lib/errors';
import { deleteSkillFile, getLatestSync } from '@/lib/natively';

/**
 * DELETE /api/natively/delete?application_id=
 * Deletes the generated Skill file + its sync rows + version history.
 * Application, candidate, and resume data are untouched.
 */
export async function DELETE(req: Request) {
  try {
    const applicationId = new URL(req.url).searchParams.get('application_id');
    if (!applicationId) throw new ApiError(400, 'application_id is required');
    const sync = getLatestSync(applicationId);
    if (!sync) throw notFound('No Skill generated for this application yet');
    const skillName = sync.skill_name as string;
    const fileDeleted = deleteSkillFile(skillName);
    run(`DELETE FROM skill_versions WHERE application_id = ?`, applicationId);
    run(`DELETE FROM skills_sync WHERE application_id = ?`, applicationId);
    return NextResponse.json({ deleted: true, skill_name: skillName, file_deleted: fileDeleted });
  } catch (e) { return handleError(e); }
}
