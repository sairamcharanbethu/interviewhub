export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get, run, now } from '@/lib/db';
import { handleError, ApiError, notFound } from '@/lib/errors';
import { listSkillVersions, writeSkillFile, getLatestSync, recordSkillVersion } from '@/lib/natively';

/** GET /api/natively/versions?application_id= — list saved Skill versions. */
export async function GET(req: Request) {
  try {
    const applicationId = new URL(req.url).searchParams.get('application_id');
    if (!applicationId) throw new ApiError(400, 'application_id is required');
    return NextResponse.json({ application_id: applicationId, versions: listSkillVersions(applicationId) });
  } catch (e) { return handleError(e); }
}

/**
 * POST /api/natively/versions { application_id, version_number }
 * Restore a previous version: the current file content is preserved as a
 * new version first, then the chosen version is written atomically and the
 * sync row returns to 'file_written' (import/activation must be
 * re-confirmed by the user — a restore is a new file).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const applicationId = body.application_id as string;
    const versionNumber = Number(body.version_number);
    if (!applicationId) throw new ApiError(400, 'application_id is required');
    if (!Number.isInteger(versionNumber) || versionNumber < 1) throw new ApiError(400, 'version_number is required');
    const version = get<Record<string, unknown>>(
      `SELECT * FROM skill_versions WHERE application_id = ? AND version_number = ?`,
      applicationId, versionNumber,
    );
    if (!version) throw notFound('Skill version not found');
    const sync = getLatestSync(applicationId);
    if (!sync) throw notFound('No Skill generated for this application yet');
    const skillName = version.skill_name as string;
    const { path: filePath, previousContent } = writeSkillFile(skillName, version.content as string);
    if (previousContent !== null) recordSkillVersion(applicationId, skillName, filePath, previousContent);
    run(
      `UPDATE skills_sync SET skill_path = ?, status = 'file_written', last_synced = ?, error = NULL WHERE id = ?`,
      filePath, now(), sync.id,
    );
    return NextResponse.json({ restored_version: versionNumber, skill_name: skillName, skill_path: filePath, status: 'file_written' });
  } catch (e) { return handleError(e); }
}
