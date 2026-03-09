import { NextResponse } from 'next/server';
import { revertSkillToVersion } from '@/lib/skill-store';

type Params = { params: Promise<{ name: string; version: string }> };

// POST /api/skills/[name]/history/[version]/revert — 回滚到指定版本
export async function POST(_req: Request, { params }: Params) {
  const { name, version } = await params;
  try {
    const ok = await revertSkillToVersion(name, version);
    if (!ok) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }
    return NextResponse.json({ name, revertedTo: version });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
