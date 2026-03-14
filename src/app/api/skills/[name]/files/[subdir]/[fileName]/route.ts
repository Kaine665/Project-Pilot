import { NextResponse } from 'next/server';
import { readSkillSubFile, writeSkillSubFile, deleteSkillSubFile } from '@/lib/skill-store';

type Params = { params: Promise<{ name: string; subdir: string; fileName: string }> };

// GET /api/skills/[name]/files/[subdir]/[fileName] — 读取子文件
export async function GET(_req: Request, { params }: Params) {
  const { name, subdir, fileName } = await params;
  try {
    const result = await readSkillSubFile(name, subdir, fileName);
    if (!result) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    return NextResponse.json({ name: fileName, subdir, content: result.content, size: result.size });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PUT /api/skills/[name]/files/[subdir]/[fileName] — 写入/更新子文件
// Body: { content: string }
export async function PUT(request: Request, { params }: Params) {
  const { name, subdir, fileName } = await params;
  try {
    const body = await request.json() as { content?: string };
    if (body.content === undefined) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }
    await writeSkillSubFile(name, subdir, fileName, body.content);
    return NextResponse.json({ name: fileName, subdir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/skills/[name]/files/[subdir]/[fileName] — 删除子文件
export async function DELETE(_req: Request, { params }: Params) {
  const { name, subdir, fileName } = await params;
  try {
    await deleteSkillSubFile(name, subdir, fileName);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
