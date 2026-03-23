import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  listSkills,
  listAllSkills,
  writeSkillFile,
  parseSkillFrontmatter,
  detectLegacySkills,
  migrateLegacySkill,
} from '@/lib/skill-store';
import { apiHandler } from '@/lib/api-handler';
import { badRequest } from '@/lib/http-error';
import { parseScopeFromParams } from './scope-utils';

// GET /api/skills — 列出 skills
// ?scope=global|project|agent  (不传=全部)
// ?projectKey=xxx  (scope=project 时必须)
// ?agentId=xxx     (scope=agent 时必须)
// ?legacy=true     (检测旧格式 skill)
export const GET = apiHandler(async (request: NextRequest) => {
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
});

// POST /api/skills — 创建新 skill 或迁移旧 skill
// Body: { content, name?, scope: { level, projectKey?, agentId? } }
// 迁移: { action: "migrate", dirName, scope: { level, projectKey?, agentId? } }
export const POST = apiHandler(async (request: NextRequest) => {
  const body = await request.json();

  // 迁移旧格式 skill
  if (body.action === 'migrate') {
    if (!body.dirName || !body.scope?.level) {
      throw badRequest('dirName and scope.level are required');
    }
    const scope = parseScopeFromBody(body.scope);
    await migrateLegacySkill(body.dirName, scope);
    return NextResponse.json({ migrated: body.dirName, scope });
  }

  // 创建新 skill
  if (!body.content) {
    throw badRequest('content is required');
  }

  const meta = parseSkillFrontmatter(body.content);
  if (!meta) {
    throw badRequest('content must have valid YAML frontmatter with name and description');
  }

  const skillName = typeof body.name === 'string' && body.name.trim()
    ? body.name.trim()
    : meta.name;
  const scope = body.scope ? parseScopeFromBody(body.scope) : { level: 'global' as const };
  await writeSkillFile(skillName, body.content, scope);
  return NextResponse.json({ name: skillName, scope }, { status: 201 });
});

function parseScopeFromBody(s: { level: string; projectKey?: string; agentId?: string }) {
  return parseScopeFromParams(new URLSearchParams({
    scope: s.level,
    ...(s.projectKey ? { projectKey: s.projectKey } : {}),
    ...(s.agentId ? { agentId: s.agentId } : {}),
  }));
}
