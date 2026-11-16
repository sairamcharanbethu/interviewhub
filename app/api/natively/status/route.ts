export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { all, get } from '@/lib/db';
import { handleError, ApiError, notFound } from '@/lib/errors';
import { listInterviewSkills } from '@/lib/natively';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const applicationId = url.searchParams.get('application_id');
    if (applicationId) {
      const app = get(`SELECT id FROM applications WHERE id = ?`, applicationId);
      if (!app) throw notFound('Application not found');
      const rows = all<Record<string, unknown>>(`SELECT * FROM skills_sync WHERE application_id = ? ORDER BY last_synced DESC`, applicationId);
      return NextResponse.json({ application_id: applicationId, syncs: rows });
    }
    return NextResponse.json({ skills: listInterviewSkills() });
  } catch (e) { return handleError(e); }
}
