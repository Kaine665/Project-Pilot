import { NextResponse } from 'next/server';
import { listSkillVersions } from '@/lib/skill-store';

type Params = { params: Promise<{ name: string }> };

// GET /api/skills/[name]/history — 列出版本历史（新→旧）
export async function GET(_req: Request, { params }: Params) {
  const { name } = await params;
  try {
    const versions = await listSkillVersions(name);
    return NextResponse.json(versions);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
