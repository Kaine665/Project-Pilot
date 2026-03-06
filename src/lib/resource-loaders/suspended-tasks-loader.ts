/**
 * SuspendedTasksLoader — 将挂起的任务注入提示词，供 Agent 感知并接续。
 *
 * 只展示 status === 'suspended' 的任务。
 * ref.id is always '_suspended'.
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import type { SuspendedTask, SuspendedTasksData } from '@/types';
import { getSuspendedTasksPath, readJsonFile } from '@/lib/file-store';

export class SuspendedTasksLoader implements ResourceLoader {
  readonly type = 'suspended-tasks' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    const data = await readJsonFile<SuspendedTasksData>(getSuspendedTasksPath(), { tasks: [] });
    const suspended = data.tasks.filter(t => t.status === 'suspended');

    if (suspended.length === 0) {
      return { ref, content: '', ok: true };
    }

    const renderTask = (t: SuspendedTask, idx: number) => {
      const project = t.projectKey ? ` (${t.projectKey})` : '';
      const elapsed = formatElapsed(t.suspendedAt);
      return [
        `${idx + 1}. **[${t.id}] ${t.title}**${project}`,
        `   - 挂起时间: ${elapsed}`,
        `   - 阻塞原因: ${t.blockReason}`,
        `   - 下一步: ${t.nextSteps}`,
      ].join('\n');
    };

    const md = `以下任务已被挂起，等待接续。如果用户要求你继续某个任务，请先阅读其完整进度和上下文，然后继续工作。完成后使用 \`<complete-suspended-task id="任务ID" />\` 标记完成。\n\n${suspended.map(renderTask).join('\n\n')}\n`;

    return {
      ref,
      content: md,
      sectionTitle: `挂起的任务 (${suspended.length})`,
      ok: true,
    };
  }
}

/** 将 ISO 时间戳格式化为日期 */
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
