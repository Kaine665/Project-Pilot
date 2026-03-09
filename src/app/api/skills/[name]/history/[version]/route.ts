import { NextResponse } from 'next/server';
import { readSkillVersion } from '@/lib/skill-store';

type Params = { params: Promise<{ name: string; version: string }> };

// GET /api/skills/[name]/history/[version] — 读取特定版本内容
export async function GET(_req: Request, { params }: Params) {
  const { name, version } = await params;
  try {
    const content = await readSkillVersion(name, version);
    if (content === undefined) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }
    return NextResponse.json({ version, content });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
