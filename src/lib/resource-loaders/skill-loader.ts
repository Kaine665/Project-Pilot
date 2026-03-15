/**
 * SkillResourceLoader — resolves a skill bound to an agent.
 *
 * Supports both plain names ("git-commit" → global) and qualified IDs:
 *   "project:elapp:rn-perf"     → project-scoped
 *   "agent:xxx:safe-merge"      → agent-scoped
 *
 * Injects a brief summary (name + description) so the agent knows what skills
 * are available, without bloating the prompt with full SKILL.md content.
 *
 * Skill not found → ok: false (silent skip).
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { readSkillFile, parseSkillFrontmatter, parseQualifiedId } from '../skill-store';

export class SkillResourceLoader implements ResourceLoader {
  readonly type = 'skill' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    try {
      const { scope, skillName } = parseQualifiedId(ref.id);
      const content = await readSkillFile(skillName, scope);
      if (!content) return { ref, content: '', ok: false };

      const meta = parseSkillFrontmatter(content);
      const name = meta?.name ?? skillName;
      const description = meta?.description ?? '';

      const summary = description ? `**${name}**: ${description}` : `**${name}**`;
      return { ref, content: summary, ok: true };
    } catch {
      return { ref, content: '', ok: false };
    }
  }
}
