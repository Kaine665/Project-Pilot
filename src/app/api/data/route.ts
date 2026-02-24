import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import { getFlowDataPath, ensureFlowsMigrated } from '@/lib/file-store';
import { isLegacyFormat, migrateLegacyToSections } from '@/lib/flow-migration';

export async function GET(request: NextRequest) {
  const project = request.nextUrl.searchParams.get('project');
  if (!project) {
    return NextResponse.json({ error: 'project is required' }, { status: 400 });
  }

  await ensureFlowsMigrated();
  const filePath = getFlowDataPath(project);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    let data = JSON.parse(raw);

    // 自动迁移旧格式（flows[] + crossCutting[] → sections[]）
    if (isLegacyFormat(data)) {
      data = migrateLegacyToSections(data);
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }

    return NextResponse.json(data);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: 'project not found' }, { status: 404 });
    }
    if (err instanceof SyntaxError) {
      // Empty or corrupt JSON file — return empty data
      return NextResponse.json({ sections: [] });
    }
    throw err;
  }
}

export async function PUT(request: NextRequest) {
  const project = request.nextUrl.searchParams.get('project');
  if (!project) {
    return NextResponse.json({ error: 'project is required' }, { status: 400 });
  }

  await ensureFlowsMigrated();
  const data = await request.json();
  const filePath = getFlowDataPath(project);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return NextResponse.json({ ok: true });
}
