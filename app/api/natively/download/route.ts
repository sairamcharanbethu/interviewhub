export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { handleError, ApiError, notFound } from '@/lib/errors';
import { loadApplicationContext, readSkillFile, skillFileName, skillNameFor } from '@/lib/natively';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const applicationId = url.searchParams.get('application_id');
    if (!applicationId) throw new ApiError(400, 'application_id is required');
    const ctx = loadApplicationContext(applicationId);
    if (!ctx) throw notFound('Application not found');
    const name = skillNameFor(String(ctx.candidate.name || 'candidate'), String(ctx.app.company || ''), String(ctx.app.title || ''));
    const content = readSkillFile(name);
    if (content === null) throw notFound('SKILL.md not generated yet — POST /api/natively/generate first');
    return new NextResponse(content, {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="${skillFileName(name)}"` },
    });
  } catch (e) { return handleError(e); }
}
