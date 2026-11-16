export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { handleError, ApiError } from '@/lib/errors';
import { prepareSkillContent } from '@/lib/natively';

/** POST /api/natively/preview { application_id, resume_id? } — builds the Skill content without writing anything. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const applicationId = body.application_id as string;
    if (!applicationId) throw new ApiError(400, 'application_id is required');
    const prepared = prepareSkillContent(applicationId, (body.resume_id as string) || null);
    return NextResponse.json({
      skill_name: prepared.name,
      output_dir: prepared.outputDir,
      resume_version: (prepared.ctx.resume?.version as number | undefined) ?? null,
      resume_source: prepared.ctx.resumeSource,
      jd_hash: prepared.jdHash.slice(0, 12),
      truncated: prepared.built.truncated,
      omitted_chars: prepared.built.omittedChars,
      resume_included_chars: prepared.built.resumeIncludedChars,
      jd_included_chars: prepared.built.jdIncludedChars,
      content_chars: prepared.built.content.length,
      content: prepared.built.content,
    });
  } catch (e) { return handleError(e); }
}
