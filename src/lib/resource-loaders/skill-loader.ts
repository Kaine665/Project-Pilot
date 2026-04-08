/**
 * SkillResourceLoader — resolves a skill bound to an agent.
 *
 * Supports both plain names ("git-commit" → global) and qualified IDs:
 *   "project:elapp:rn-perf"     → project-scoped
 *   "agent:xxx:safe-merge"      → agent-scoped
 *
 * 与 AgentSkills / OpenClaw 一致：注入 **完整 SKILL.md 正文**（frontmatter 外的说明），
 * 并在正文前附带 name + description 标题块，便于模型按标准 skill 结构阅读。
 * `disable-model-invocation: true` 时不注入（返回空 content、ok: true）。
 *
 * Skill not found → ok: false (silent skip).
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import {
  readSkillFile,
  parseSkillFrontmatter,
  parseQualifiedId,
  stripSkillFrontmatter,
} from '../skill-store';

export class SkillResourceLoader implements ResourceLoader {
  readonly type = 'skill' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    try {
      const { scope, skillName } = parseQualifiedId(ref.id);
      const content = await readSkillFile(skillName, scope);
      if (!content) return { ref, content: '', ok: false };

      const meta = parseSkillFrontmatter(content);
      if (meta?.disableModelInvocation) {
        return { ref, content: '', ok: true };
      }

      const name = meta?.name ?? skillName;
      const description = meta?.description ?? '';
      const body = meta ? stripSkillFrontmatter(content) : content.trim();

      const headerLines = [`### Skill: ${name}`];
      if (description) headerLines.push(description);
      const header = `${headerLines.join('\n')}\n\n`;
      const injected = `${header}${body}`.trimEnd();
      return { ref, content: injected, ok: true };
    } catch {
      return { ref, content: '', ok: false };
    }
  }
}
