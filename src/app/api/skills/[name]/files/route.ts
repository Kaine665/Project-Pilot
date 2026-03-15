import { NextResponse } from 'next/server';
import { listSkillFiles } from '@/lib/skill-store';
import { parseScopeFromParams } from '../../scope-utils';

type Params = { params: Promise<{ name: string }> };

// GET /api/skills/[name]/files?scope=...
export async function GET(req: Request, { params }: Params) {
  const { name } = await params;
  try {
    const url = new URL(req.url);
    const scope = parseScopeFromParams(url.searchParams);
    const files = await listSkillFiles(name, scope);
    return NextResponse.json(files);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
