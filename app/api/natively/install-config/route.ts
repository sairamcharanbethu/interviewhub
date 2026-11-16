export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { resolveNativelySkillsDir, macosDefaultNativelySkillsDir } from '@/lib/files';
import { handleError } from '@/lib/errors';

/**
 * GET /api/natively/install-config
 *
 * Reports the resolved Natively Skills directory and whether it could be
 * verified — so the UI can show the destination and block installation
 * when it is unconfigured or unverified. Never silently falls back to
 * data/skills/ (that is the manual-export directory).
 */
export async function GET() {
  try {
    const info = resolveNativelySkillsDir();
    return NextResponse.json({
      ...info,
      macos_default: macosDefaultNativelySkillsDir(),
      env_var: 'NATIVELY_SKILLS_DIR',
      note: 'Installed means the SKILL.md file was written to this directory. It does not mean Natively has loaded or activated the Skill — bring Natively to the front; it re-reads the Skills folder when its window regains focus.',
    });
  } catch (e) {
    return handleError(e);
  }
}
