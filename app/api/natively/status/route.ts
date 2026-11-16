export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { all, get } from '@/lib/db';
import { handleError, ApiError, notFound } from '@/lib/errors';
import { listInterviewSkills, loadApplicationContext, getLatestSync, isSyncOutdated } from '@/lib/natively';
import { installUpdateAvailable } from '@/lib/natively-install';
import { skillsDir as skillsDirFn, resolveNativelySkillsDir } from '@/lib/files';

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
      // Installation info for this application (automatic Natively install).
      let install: Record<string, unknown> | null = null;
      if (latest) {
        const installStatus = latest.status as string;
        install = {
          status: installStatus,
          slug: (latest.install_slug as string) || null,
          skill_path: (latest.install_path as string) || null,
          install_method: (latest.install_method as string) || null,
          installed_at: (latest.installed_at as string) || null,
          updated_at: (latest.updated_at as string) || null,
          install_error: (latest.install_error as string) || null,
          slash_command:
            latest.install_slug && (installStatus === 'installed' || installStatus === 'update_available')
              ? `/${latest.install_slug as string}`
              : null,
          update_available: installUpdateAvailable(applicationId),
        };
      }
      return NextResponse.json({
        application_id: applicationId,
        syncs: rows,
        outdated,
        output_dir: skillsDirFn(),
        install,
        natively_dir: resolveNativelySkillsDir(),
      });
    }
    return NextResponse.json({
      skills: listInterviewSkills(),
      output_dir: skillsDirFn(),
      natively_dir: resolveNativelySkillsDir(),
    });
  } catch (e) { return handleError(e); }
}
