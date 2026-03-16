/**
 * 从 URL searchParams 解析 SkillScope。
 * 规则：
 *   scope=global            → { level: 'global' }
 *   scope=project&projectKey=xxx → { level: 'project', projectKey: 'xxx' }
 *   scope=agent&agentId=xxx      → { level: 'agent', agentId: 'xxx' }
 *   不传 scope               → 默认 global（向后兼容）
 */

import type { SkillScope } from '@/lib/file-store';

export function parseScopeFromParams(params: URLSearchParams): SkillScope {
  const level = params.get('scope') ?? 'global';

  switch (level) {
    case 'project': {
      const projectKey = params.get('projectKey');
      if (!projectKey) throw new Error('projectKey is required for scope=project');
      return { level: 'project', projectKey };
    }
    case 'agent': {
      const agentId = params.get('agentId');
      if (!agentId) throw new Error('agentId is required for scope=agent');
      return { level: 'agent', agentId };
    }
    case 'global':
    default:
      return { level: 'global' };
  }
}
