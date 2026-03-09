/**
 * SkillResourceLoader — resolves a skill bound to an agent.
 *
 * Injects a brief summary (name + description) so the agent knows what skills
 * are available, without bloating the prompt with full SKILL.md content.
 *
 * ref.id = skill name (e.g. 'git-commit')
 * Skill not found → ok: false (silent skip).
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { readSkillFile, parseSkillFrontmatter } from '../skill-store';

export class SkillResourceLoader implements ResourceLoader {
  readonly type = 'skill' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    try {
      const content = await readSkillFile(ref.id);
      if (!content) return { ref, content: '', ok: false };

      const meta = parseSkillFrontmatter(content);
      const name = meta?.name ?? ref.id;
      const description = meta?.description ?? '';

      const summary = description ? `**${name}**: ${description}` : `**${name}**`;
      return { ref, content: summary, ok: true };
    } catch {
      return { ref, content: '', ok: false };
    }
  }
}
