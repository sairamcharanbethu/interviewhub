export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { run, newId, now } from '@/lib/db';
import { handleError, notFound, ApiError } from '@/lib/errors';
import { buildSkillMd, loadApplicationContext, skillNameFor, writeSkillFile } from '@/lib/natively';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const applicationId = body.application_id as string;
    if (!applicationId) throw new ApiError(400, 'application_id is required');
    const ctx = loadApplicationContext(applicationId);
    if (!ctx) throw notFound('Application not found');
    const name = skillNameFor(String(ctx.candidate.name || 'candidate'), String(ctx.app.company || ''), String(ctx.app.title || ''));
    const content = buildSkillMd(ctx.app, ctx.candidate, ctx.resume, ctx.stories);
    const filePath = writeSkillFile(name, content);
    const syncId = newId('sync_');
    run(
      `INSERT INTO skills_sync (id, application_id, skill_name, skill_path, status, last_synced) VALUES (?, ?, ?, ?, 'synced', ?)`,
      syncId, applicationId, name, filePath, now(),
    );
    return NextResponse.json({ skill_name: name, skill_path: filePath, status: 'synced' }, { status: 201 });
  } catch (e) { return handleError(e); }
}
