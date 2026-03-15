import { NextResponse } from 'next/server';
import { listSkills, listAllSkills, readSkillFile } from '@/lib/skill-store';
import { parseScopeFromParams } from '../scope-utils';
import { exportSkill, listExportFormats } from '@/lib/skill-export';
import type { SkillScope } from '@/lib/file-store';

/**
 * GET /api/skills/export-all?format=openclaw&scope=global
 *
 * 批量导出所有（或指定 scope）Skill。
 * - format 缺省时返回可用格式列表。
 * - scope 缺省时导出所有 scope 的 Skill。
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const format = url.searchParams.get('format');

    // 如果没有指定 format，返回可用格式列表
    if (!format) {
      return NextResponse.json({ formats: listExportFormats() });
    }

    // 确定要导出的 scope
    const scopeParam = url.searchParams.get('scope');
    let scope: SkillScope | undefined;
    if (scopeParam) {
      scope = parseScopeFromParams(url.searchParams);
    }

    // 列出 skills
    const skillList = scope ? await listSkills(scope) : await listAllSkills();

    // 逐个读取并转换
    const skills = await Promise.all(
      skillList.map(async (item) => {
        const content = await readSkillFile(item.name, item.scope);
        if (!content) return null;
        return exportSkill({ name: item.name, content }, format);
      }),
    );

    return NextResponse.json({
      format,
      skills: skills.filter(Boolean),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('Unknown export format') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
