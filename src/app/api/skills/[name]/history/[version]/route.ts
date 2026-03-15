import { NextResponse } from 'next/server';
import { readSkillVersion } from '@/lib/skill-store';
import { parseScopeFromParams } from '../../../scope-utils';

type Params = { params: Promise<{ name: string; version: string }> };

// GET /api/skills/[name]/history/[version]?scope=...
export async function GET(req: Request, { params }: Params) {
  const { name, version } = await params;
  try {
    const url = new URL(req.url);
    const scope = parseScopeFromParams(url.searchParams);
    const content = await readSkillVersion(name, version, scope);
    if (content === undefined) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }
    return NextResponse.json({ version, content });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
