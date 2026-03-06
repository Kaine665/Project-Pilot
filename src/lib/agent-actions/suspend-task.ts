/**
 * suspend-task action — AI 可以将当前任务挂起，保存进度供其他会话接续。
 *
 * 标签格式：
 * <suspend-task title="任务标题" project="项目key(可选)">
 * ## 进度
 * ...
 * ## 阻塞原因
 * ...
 * ## 下一步
 * ...
 * ## 上下文
 * ...
 * </suspend-task>
 */

import {
  getSuspendedTasksPath,
  modifyJsonFile,
} from '@/lib/file-store';
import type { SuspendedTask, SuspendedTasksData } from '@/types';
import type { AgentAction, ActionContext } from './types';

// ── Parsed tag data ──

interface SuspendTaskTagData {
  title: string;
  project?: string;
  body: string;
}

// ── Body parser: extract sections from markdown ──

function parseSections(body: string): {
  progress: string;
  blockReason: string;
  nextSteps: string;
  context?: string;
} {
  const sectionMap: Record<string, string> = {};
  const lines = body.split('\n');
  let currentKey = '';

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)/);
    if (heading) {
      const title = heading[1].trim();
      if (/进度/.test(title)) currentKey = 'progress';
      else if (/阻塞|原因/.test(title)) currentKey = 'blockReason';
      else if (/下一步|恢复/.test(title)) currentKey = 'nextSteps';
      else if (/上下文|context/i.test(title)) currentKey = 'context';
      else currentKey = '';
      continue;
    }
    if (currentKey) {
      sectionMap[currentKey] = (sectionMap[currentKey] || '') + line + '\n';
    }
  }

  return {
    progress: (sectionMap['progress'] || '').trim() || '（未提供）',
    blockReason: (sectionMap['blockReason'] || '').trim() || '（未提供）',
    nextSteps: (sectionMap['nextSteps'] || '').trim() || '（未提供）',
    context: sectionMap['context']?.trim() || undefined,
  };
}

// ── Action definition ──

const TAG_REGEX = /<suspend-task\s+title="([^"]+)"(?:\s+project="([^"]*)")?\s*>([\s\S]*?)<\/suspend-task>/g;

export const suspendTaskAction: AgentAction<SuspendTaskTagData> = {
  id: 'suspend-task',
  resourceType: 'suspend-task-instructions',
  sectionTitle: '任务挂起',
  priority: 86,

  instructions: `当用户告诉你"先存起来"、"先暂停"、"下次再继续"等，你应该将当前任务的进度结构化保存，以便未来其他会话或 Agent 接续。使用以下格式：

<suspend-task title="任务标题（简短）" project="项目key（可选）">
## 进度
- 已完成的事项...

## 阻塞原因
为什么现在无法继续...

## 下一步
1. 恢复后应该做的事...

## 上下文
- 相关文件、分支、依赖等补充信息...
</suspend-task>

注意：
- title 应简明扼要（5-20 字）
- 四个段落都应尽量填写，尤其是"阻塞原因"和"下一步"
- 挂起的任务会出现在所有 Agent 的提示词中，其他会话可以接续
- 接续任务后完成时，使用 \`<complete-suspended-task id="任务ID" />\` 标记完成`,

  parse(text: string): SuspendTaskTagData[] {
    const results: SuspendTaskTagData[] = [];
    const regex = new RegExp(TAG_REGEX.source, TAG_REGEX.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      results.push({
        title: match[1].trim(),
        project: match[2]?.trim() || undefined,
        body: match[3].trim(),
      });
    }
    return results;
  },

  strip(text: string): string {
    return text.replace(/<suspend-task[\s\S]*?<\/suspend-task>/g, '').trim();
  },

  async execute(data: SuspendTaskTagData, ctx: ActionContext): Promise<void> {
    const now = new Date().toISOString();
    const id = `suspend-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const sections = parseSections(data.body);

    const task: SuspendedTask = {
      id,
      title: data.title,
      projectKey: data.project,
      agentId: ctx.agentId,
      sessionId: ctx.sessionId,
      progress: sections.progress,
      blockReason: sections.blockReason,
      nextSteps: sections.nextSteps,
      context: sections.context,
      status: 'suspended',
      suspendedAt: now,
    };

    await modifyJsonFile<SuspendedTasksData>(
      getSuspendedTasksPath(),
      { tasks: [] },
      (d) => { d.tasks.push(task); return d; },
    );

    ctx.emit({ type: 'task_suspended', taskId: id, title: data.title });
  },
};
