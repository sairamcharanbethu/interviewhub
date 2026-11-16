export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get, run, newId, now, transaction } from '@/lib/db';
import { handleError, notFound, ApiError } from '@/lib/errors';
import {
  prepareSkillContent,
  writeSkillFile,
  recordSkillVersion,
  getLatestSync,
  readSkillFile,
  skillFileName,
} from '@/lib/natively';

/**
 * POST /api/natively/generate { application_id, resume_id?, confirm_overwrite? }
 *
 * Writes the standalone interview-*.md file atomically and records status
 * 'file_written' — NEVER 'imported'/'activation_verified' (those need the
 * user's manual confirmation via /api/natively/confirm).
 * If a file owned by THIS application already exists and confirm_overwrite
 * is not set, returns 409 { needs_confirmation: true } so the UI can ask.
 * A file owned by ANOTHER application is never overwritten: the name gets a
 * -2/-3 suffix instead (see resolveSkillName).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const applicationId = body.application_id as string;
    if (!applicationId) throw new ApiError(400, 'application_id is required');
    const explicitResumeId = (body.resume_id as string) || null;
    const prepared = prepareSkillContent(applicationId, explicitResumeId);
    const { ctx, name, built, jdHash, contentHash, outputDir } = prepared;

    const existing = getLatestSync(applicationId);
    const existingName = existing?.skill_name as string | undefined;
    if (existingName === name && body.confirm_overwrite !== true) {
      if (readSkillFile(name) !== null) {
        return NextResponse.json(
          {
            needs_confirmation: true,
            skill_name: name,
            skill_path: existing?.skill_path as string | undefined,
            message: `A Skill file ${skillFileName(name)} already exists for this application. Regenerating will replace it (the previous version is kept for restore). Send confirm_overwrite: true to proceed.`,
          },
          { status: 409 },
        );
      }
    }

    const { path: filePath, previousContent } = writeSkillFile(name, built.content);
    const resumeVersion = (ctx.resume?.version as number | undefined) ?? null;
    transaction(() => {
      if (previousContent !== null) {
        recordSkillVersion(applicationId, name, filePath, previousContent);
      }
      const prior = get<{ id: string }>(`SELECT id FROM skills_sync WHERE application_id = ? AND skill_name = ?`, applicationId, name);
      if (prior) {
        run(
          `UPDATE skills_sync SET skill_path = ?, status = 'file_written', last_synced = ?, resume_version = ?, jd_hash = ?, content_hash = ?, version_number = version_number + 1, error = NULL WHERE id = ?`,
          filePath, now(), resumeVersion, jdHash, contentHash, prior.id,
        );
      } else {
        run(
          `INSERT INTO skills_sync (id, application_id, skill_name, skill_path, status, last_synced, resume_version, jd_hash, content_hash, version_number) VALUES (?, ?, ?, ?, 'file_written', ?, ?, ?, ?, 1)`,
          newId('sync_'), applicationId, name, filePath, now(), resumeVersion, jdHash, contentHash,
        );
      }
    });
    return NextResponse.json(
      {
        skill_name: name,
        skill_path: filePath,
        output_dir: outputDir,
        status: 'file_written',
        resume_version: resumeVersion,
        resume_source: ctx.resumeSource,
        jd_hash: jdHash.slice(0, 12),
        truncated: built.truncated,
        omitted_chars: built.omittedChars,
        previous_version_saved: previousContent !== null,
      },
      { status: 201 },
    );
  } catch (e) {
    return handleError(e);
  }
}
