import { NextResponse } from 'next/server';
import {
  listSkills,
  listAllSkills,
  writeSkillFile,
  parseSkillFrontmatter,
  detectLegacySkills,
  migrateLegacySkill,
} from '@/lib/skill-store';
import { parseScopeFromParams } from './scope-utils';

// GET /api/skills — 列出 skills
// ?scope=global|project|agent  (不传=全部)
// ?projectKey=xxx  (scope=project 时必须)
// ?agentId=xxx     (scope=agent 时必须)
// ?legacy=true     (检测旧格式 skill)
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    // 检测旧格式
    if (url.searchParams.get('legacy') === 'true') {
      const legacy = await detectLegacySkills();
      return NextResponse.json(legacy);
    }

    const scopeParam = url.searchParams.get('scope');
    if (!scopeParam) {
      // 不传 scope → 列出所有层级
      const skills = await listAllSkills();
      return NextResponse.json(skills);
    }

    const scope = parseScopeFromParams(url.searchParams);
    const skills = await listSkills(scope);
    return NextResponse.json(skills);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/skills — 创建新 skill 或迁移旧 skill
// Body: { name, content, scope: { level, projectKey?, agentId? } }
// 迁移: { action: "migrate", dirName, scope: { level, projectKey?, agentId? } }
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // 迁移旧格式 skill
    if (body.action === 'migrate') {
      if (!body.dirName || !body.scope?.level) {
        return NextResponse.json({ error: 'dirName and scope.level are required' }, { status: 400 });
      }
      const scope = parseScopeFromBody(body.scope);
      await migrateLegacySkill(body.dirName, scope);
      return NextResponse.json({ migrated: body.dirName, scope });
    }

    // 创建新 skill
    if (!body.name || !body.content) {
      return NextResponse.json({ error: 'name and content are required' }, { status: 400 });
    }

    const meta = parseSkillFrontmatter(body.content);
    if (!meta) {
      return NextResponse.json({ error: 'content must have valid YAML frontmatter with name and description' }, { status: 400 });
    }

    const scope = body.scope ? parseScopeFromBody(body.scope) : { level: 'global' as const };
    await writeSkillFile(body.name, body.content, scope);
    return NextResponse.json({ name: body.name, scope }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

function parseScopeFromBody(s: { level: string; projectKey?: string; agentId?: string }) {
  return parseScopeFromParams(new URLSearchParams({
    scope: s.level,
    ...(s.projectKey ? { projectKey: s.projectKey } : {}),
    ...(s.agentId ? { agentId: s.agentId } : {}),
  }));
}
