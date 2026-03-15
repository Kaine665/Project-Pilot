import { NextResponse } from 'next/server';
import { readSkillSubFile, writeSkillSubFile, deleteSkillSubFile } from '@/lib/skill-store';
import { parseScopeFromParams } from '../../../../scope-utils';

type Params = { params: Promise<{ name: string; subdir: string; fileName: string }> };

// GET /api/skills/[name]/files/[subdir]/[fileName]?scope=...
export async function GET(req: Request, { params }: Params) {
  const { name, subdir, fileName } = await params;
  try {
    const url = new URL(req.url);
    const scope = parseScopeFromParams(url.searchParams);
    const result = await readSkillSubFile(name, subdir, fileName, scope);
    if (!result) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    return NextResponse.json({ name: fileName, subdir, content: result.content, size: result.size });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PUT /api/skills/[name]/files/[subdir]/[fileName]?scope=...
export async function PUT(request: Request, { params }: Params) {
  const { name, subdir, fileName } = await params;
  try {
    const url = new URL(request.url);
    const scope = parseScopeFromParams(url.searchParams);
    const body = await request.json() as { content?: string };
    if (body.content === undefined) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }
    await writeSkillSubFile(name, subdir, fileName, body.content, scope);
    return NextResponse.json({ name: fileName, subdir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/skills/[name]/files/[subdir]/[fileName]?scope=...
export async function DELETE(req: Request, { params }: Params) {
  const { name, subdir, fileName } = await params;
  try {
    const url = new URL(req.url);
    const scope = parseScopeFromParams(url.searchParams);
    await deleteSkillSubFile(name, subdir, fileName, scope);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
