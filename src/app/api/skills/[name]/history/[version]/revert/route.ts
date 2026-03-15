import { NextResponse } from 'next/server';
import { revertSkillToVersion } from '@/lib/skill-store';
import { parseScopeFromParams } from '../../../../scope-utils';

type Params = { params: Promise<{ name: string; version: string }> };

// POST /api/skills/[name]/history/[version]/revert?scope=...
export async function POST(req: Request, { params }: Params) {
  const { name, version } = await params;
  try {
    const url = new URL(req.url);
    const scope = parseScopeFromParams(url.searchParams);
    const ok = await revertSkillToVersion(name, version, scope);
    if (!ok) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }
    return NextResponse.json({ name, revertedTo: version });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
