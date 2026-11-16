export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { all, get } from '@/lib/db';
import { handleError, ApiError, notFound } from '@/lib/errors';
import { listInterviewSkills, loadApplicationContext, getLatestSync, isSyncOutdated } from '@/lib/natively';
import { skillsDir as skillsDirFn } from '@/lib/files';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const applicationId = url.searchParams.get('application_id');
    if (applicationId) {
      const app = get(`SELECT id FROM applications WHERE id = ?`, applicationId);
      if (!app) throw notFound('Application not found');
      const rows = all<Record<string, unknown>>(`SELECT * FROM skills_sync WHERE application_id = ? ORDER BY last_synced DESC`, applicationId);
      // Enrich the latest row with a live outdated check (resume/JD may have
      // changed since generation) without mutating the stored status — the
      // stored status only changes on generate / explicit user confirmation.
      let outdated = false;
      const latest = rows[0];
      if (latest) {
        // Outdated is advisory: an invalid resume selection must not break
        // the status read itself.
        try {
          const ctx = loadApplicationContext(applicationId);
          if (ctx) outdated = isSyncOutdated(latest, ctx.app, ctx.resume);
        } catch { outdated = false; }
      }
      return NextResponse.json({
        application_id: applicationId,
        syncs: rows,
        outdated,
        output_dir: skillsDirFn(),
      });
    }
    return NextResponse.json({ skills: listInterviewSkills(), output_dir: skillsDirFn() });
  } catch (e) { return handleError(e); }
}
