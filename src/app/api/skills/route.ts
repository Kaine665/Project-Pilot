import { NextResponse } from 'next/server';
import { listSkills, writeSkillFile, parseSkillFrontmatter } from '@/lib/skill-store';

// GET /api/skills — 列出所有 skills
export async function GET() {
  try {
    const skills = await listSkills();
    return NextResponse.json(skills);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/skills — 创建新 skill
// Body: { name: string, content: string }
export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: string; content?: string };
    if (!body.name || !body.content) {
      return NextResponse.json({ error: 'name and content are required' }, { status: 400 });
    }

    // 验证 frontmatter 中的 name 与路径 name 一致
    const meta = parseSkillFrontmatter(body.content);
    if (!meta) {
      return NextResponse.json({ error: 'content must have valid YAML frontmatter with name and description' }, { status: 400 });
    }

    await writeSkillFile(body.name, body.content);
    return NextResponse.json({ name: body.name }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
