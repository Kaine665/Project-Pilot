/**
 * ActiveTasksLoader — renders the shared active tasks board.
 *
 * Shows all currently running tasks from other agents,
 * so each agent can be aware of parallel work and avoid conflicts.
 *
 * ref.id is always '_running'.
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { listRunningTasks } from '@/lib/active-tasks';

export class ActiveTasksLoader implements ResourceLoader {
  readonly type = 'active-tasks' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    const tasks = await listRunningTasks();

    if (tasks.length === 0) {
      return { ref, content: '', ok: true };
    }

    const tableHeader = '| 任务 | Agent 类型 | 项目 | 涉及范围 | 分支 | 开始时间 |\n|------|-----------|------|---------|------|---------|';

    const toRow = (t: typeof tasks[number]) => {
      const scope = t.scope ? t.scope.map(s => `\`${s}\``).join(', ') : '-';
      const branch = t.branch ? `\`${t.branch}\`` : '-';
      const project = t.projectKey || '-';
      const elapsed = formatElapsed(t.registeredAt);
      return `| ${t.title} | ${t.agentType} | ${project} | ${scope} | ${branch} | ${elapsed} |`;
    };

    const md = `以下任务正在并行进行中，请注意避免冲突。如果你的任务涉及相同的文件或模块，请谨慎操作。\n\n${tableHeader}\n${tasks.map(toRow).join('\n')}\n`;

    return {
      ref,
      content: md,
      sectionTitle: '当前活跃任务',
      ok: true,
    };
  }
}

/** 将 ISO 时间戳格式化为相对时间（如 "2h ago", "30m ago"） */
function formatElapsed(isoTime: string): string {
  const ms = Date.now() - new Date(isoTime).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
