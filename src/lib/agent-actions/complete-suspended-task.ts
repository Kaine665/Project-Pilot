/**
 * complete-suspended-task action — 标记一个挂起的任务为已完成。
 *
 * 标签格式：
 * <complete-suspended-task id="suspend-xxx" />
 */

import {
  getSuspendedTasksPath,
  modifyJsonFile,
} from '@/lib/file-store';
import type { SuspendedTasksData } from '@/types';
import type { AgentAction, ActionContext } from './types';

// ── Parsed tag data ──

interface CompleteTaskTagData {
  taskId: string;
}

// ── Action definition ──

const TAG_REGEX = /<complete-suspended-task\s+id="([^"]+)"\s*\/>/g;

export const completeSuspendedTaskAction: AgentAction<CompleteTaskTagData> = {
  id: 'complete-suspended-task',
  // 不需要独立的 instructions section，说明已包含在 suspend-task 的 instructions 中
  resourceType: 'complete-suspended-task-instructions',
  sectionTitle: '',
  priority: 87,

  instructions: '', // 空指令——说明已内联在 suspend-task action 中

  parse(text: string): CompleteTaskTagData[] {
    const results: CompleteTaskTagData[] = [];
    const regex = new RegExp(TAG_REGEX.source, TAG_REGEX.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      results.push({ taskId: match[1].trim() });
    }
    return results;
  },

  strip(text: string): string {
    return text.replace(/<complete-suspended-task\s+id="[^"]+"\s*\/>/g, '').trim();
  },

  async execute(data: CompleteTaskTagData, ctx: ActionContext): Promise<void> {
    const now = new Date().toISOString();

    await modifyJsonFile<SuspendedTasksData>(
      getSuspendedTasksPath(),
      { tasks: [] },
      (d) => {
        const task = d.tasks.find(t => t.id === data.taskId);
        if (task) {
          task.status = 'completed';
          task.completedAt = now;
          task.resumedBy = ctx.sessionId;
        }
        return d;
      },
    );

    ctx.emit({ type: 'task_completed', taskId: data.taskId });
  },
};
