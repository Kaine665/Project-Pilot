import { NextResponse } from 'next/server';
import { listSkillFiles } from '@/lib/skill-store';

type Params = { params: Promise<{ name: string }> };

// GET /api/skills/[name]/files — 列出 skill 子目录中的所有文件
export async function GET(_req: Request, { params }: Params) {
  const { name } = await params;
  try {
    const files = await listSkillFiles(name);
    return NextResponse.json(files);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
