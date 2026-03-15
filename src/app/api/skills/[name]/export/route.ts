import { NextResponse } from 'next/server';
import { readSkillFile } from '@/lib/skill-store';
import { parseScopeFromParams } from '../../scope-utils';
import { exportSkill, listExportFormats } from '@/lib/skill-export';

type Params = { params: Promise<{ name: string }> };

/**
 * GET /api/skills/{name}/export?scope=global&format=openclaw
 *
 * 导出单个 Skill 为指定格式。
 * - format 缺省时返回可用格式列表。
 */
export async function GET(req: Request, { params }: Params) {
  const { name } = await params;
  try {
    const url = new URL(req.url);
    const scope = parseScopeFromParams(url.searchParams);
    const format = url.searchParams.get('format');

    // 如果没有指定 format，返回可用格式列表
    if (!format) {
      return NextResponse.json({ formats: listExportFormats() });
    }

    const content = await readSkillFile(name, scope);
    if (content === undefined) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    }

    const exported = exportSkill({ name, content }, format);
    return NextResponse.json(exported);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('Unknown export format') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
