export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { handleError, ApiError, notFound } from '@/lib/errors';
import { getLatestSync, readSkillFile, skillFileName } from '@/lib/natively';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const applicationId = url.searchParams.get('application_id');
    if (!applicationId) throw new ApiError(400, 'application_id is required');
    // Use the application's OWN latest sync name (it may carry a -2 suffix
    // from collision resolution) rather than recomputing the base name.
    const sync = getLatestSync(applicationId);
    const name = (sync?.skill_name as string) || null;
    if (!name) throw notFound('No Skill generated for this application yet — POST /api/natively/generate first');
    const content = readSkillFile(name);
    if (content === null) throw notFound('Skill file is missing from disk — regenerate it');
    return new NextResponse(content, {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="${skillFileName(name)}"` },
    });
  } catch (e) { return handleError(e); }
}
