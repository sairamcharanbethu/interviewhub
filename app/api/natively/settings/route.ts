export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get, run } from '@/lib/db';
import { handleError, ApiError } from '@/lib/errors';
import { DEFAULT_SKILL_CONTEXT_CHARS } from '@/lib/natively';

/**
 * Skill context budget (chars of resume+JD excerpt in a generated Skill).
 * GET returns the current value + default; POST sets it (1000–200000).
 * Kept separate from /api/ai-settings so the AI key handling stays in one
 * place (security track owns that route).
 */
export async function GET() {
  try {
    const row = get<Record<string, unknown>>(`SELECT skill_context_chars FROM ai_settings WHERE id = 1`);
    const n = row?.skill_context_chars as number | null;
    return NextResponse.json({
      skill_context_chars: typeof n === 'number' && n > 0 ? n : DEFAULT_SKILL_CONTEXT_CHARS,
      default: DEFAULT_SKILL_CONTEXT_CHARS,
    });
  } catch (e) { return handleError(e); }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const n = Number(body.skill_context_chars);
    if (!Number.isInteger(n) || n < 1000 || n > 200000) {
      throw new ApiError(400, 'skill_context_chars must be an integer between 1000 and 200000');
    }
    run(`UPDATE ai_settings SET skill_context_chars = ? WHERE id = 1`, n);
    return NextResponse.json({ skill_context_chars: n, default: DEFAULT_SKILL_CONTEXT_CHARS });
  } catch (e) { return handleError(e); }
}
