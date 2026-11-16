export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { all, get } from '@/lib/db';
import { handleError } from '@/lib/errors';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
    const rows = all<Record<string, unknown>>(`SELECT * FROM ai_usage ORDER BY created_at DESC LIMIT ?`, limit);
    const total = get<{ total: number; count: number }>(`SELECT COALESCE(SUM(cost_usd), 0) AS total, COUNT(*) AS count FROM ai_usage`);
    return NextResponse.json({ usage: rows, total_cost_usd: total?.total ?? 0, count: total?.count ?? 0 });
  } catch (e) { return handleError(e); }
}
