import { NextRequest, NextResponse } from 'next/server';
import { validatePackage, importAgent } from '@/lib/agent-package';

/** POST /api/agents/import — 导入 .ppagent 文件创建新 Agent */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!validatePackage(body)) {
      return NextResponse.json(
        { error: '无效的 .ppagent 文件格式' },
        { status: 400 },
      );
    }

    const result = await importAgent(body);

    return NextResponse.json({
      ok: true,
      agent: result.agent,
      contextsImported: result.contextsImported,
    });
  } catch (err) {
    console.error('[agents/import] Import failed:', err);
    return NextResponse.json(
      { error: '导入失败: ' + (err instanceof Error ? err.message : String(err)) },
      { status: 500 },
    );
  }
}
