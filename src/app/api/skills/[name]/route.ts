import { NextResponse } from 'next/server';
import { readSkillFile, writeSkillFile, deleteSkillFile, parseSkillFrontmatter } from '@/lib/skill-store';

type Params = { params: Promise<{ name: string }> };

// GET /api/skills/[name] — 读取 skill 内容
export async function GET(_req: Request, { params }: Params) {
  const { name } = await params;
  try {
    const content = await readSkillFile(name);
    if (content === undefined) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    }
    const meta = parseSkillFrontmatter(content);
    return NextResponse.json({ name, description: meta?.description ?? '', content });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PUT /api/skills/[name] — 更新 skill 内容（自动快照历史）
// Body: { content: string }
export async function PUT(request: Request, { params }: Params) {
  const { name } = await params;
  try {
    const body = await request.json() as { content?: string };
    if (!body.content) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }
    const meta = parseSkillFrontmatter(body.content);
    if (!meta) {
      return NextResponse.json({ error: 'content must have valid YAML frontmatter with name and description' }, { status: 400 });
    }
    await writeSkillFile(name, body.content);
    return NextResponse.json({ name });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/skills/[name] — 删除 skill（含历史）
export async function DELETE(_req: Request, { params }: Params) {
  const { name } = await params;
  try {
    await deleteSkillFile(name);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
