import { NextResponse } from 'next/server';
import { readSkillFile, writeSkillFile, deleteSkillFile, parseSkillFrontmatter } from '@/lib/skill-store';
import { parseScopeFromParams } from '../scope-utils';

type Params = { params: Promise<{ name: string }> };

// GET /api/skills/[name]?scope=...&projectKey=...&agentId=...
export async function GET(req: Request, { params }: Params) {
  const { name } = await params;
  try {
    const url = new URL(req.url);
    const scope = parseScopeFromParams(url.searchParams);
    const content = await readSkillFile(name, scope);
    if (content === undefined) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    }
    const meta = parseSkillFrontmatter(content);
    return NextResponse.json({
      name: meta?.name ?? name,
      description: meta?.description ?? '',
      content,
      scope,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PUT /api/skills/[name]?scope=...
// Body: { content: string }
export async function PUT(request: Request, { params }: Params) {
  const { name } = await params;
  try {
    const url = new URL(request.url);
    const scope = parseScopeFromParams(url.searchParams);
    const body = await request.json() as { content?: string };
    if (!body.content) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }
    const meta = parseSkillFrontmatter(body.content);
    if (!meta) {
      return NextResponse.json({ error: 'content must have valid YAML frontmatter with name and description' }, { status: 400 });
    }
    await writeSkillFile(name, body.content, scope);
    return NextResponse.json({ name, scope });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/skills/[name]?scope=...
export async function DELETE(req: Request, { params }: Params) {
  const { name } = await params;
  try {
    const url = new URL(req.url);
    const scope = parseScopeFromParams(url.searchParams);
    await deleteSkillFile(name, scope);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
