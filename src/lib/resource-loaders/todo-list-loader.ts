/**
 * TodoListLoader — resolves pending todo items into prompt text,
 * along with API documentation so the AI knows how to operate on them.
 *
 * ref.id = 'pending' (non-done items) or 'all'.
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { readTodosMerged } from '@/lib/todo-file-store';

const PRIORITY_LABELS: Record<string, string> = { high: '高', medium: '中', low: '低' };
const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  in_progress: '进行中',
  done: '已完成',
};

const MCP_GUIDE = `### 待办操作（优先使用 MCP 工具）

本会话已注册 MCP 服务器 **projectpilot-todos**（结构化工具调用，勿用 Bash/curl 访问 HTTP）。

| 工具 | 用途 |
|------|------|
| \`list_todos\` | 列出当前会话可见待办（可选 \`includeDone\`） |
| \`create_todo\` | 新建（\`title\` 必填；\`description\`、\`priority\`、\`status\`、\`agentId\`、\`projectKey\` 可选） |
| \`update_todo\` | 更新（\`id\` 必填 + 要改的字段） |
| \`delete_todo\` | 删除（\`id\`） |

**status**: \`pending\` / \`in_progress\` / \`done\`  
**priority**: \`high\` / \`medium\` / \`low\`  
**id** 格式: \`todo-{timestamp}\`

开始处理某条待办时请 \`update_todo\` 将 \`status\` 设为 \`in_progress\`；完成后设为 \`done\`。

（REST \`/api/todos\` 仍供应用前端使用；Agent 侧请只用上述 MCP 工具。）`;

export class TodoListLoader implements ResourceLoader {
  readonly type = 'todo-list' as const;

  async resolve(ref: ResourceRef, ctx: LoaderContext): Promise<ResolvedResource> {
    const data = await readTodosMerged();
    let todos = ref.id === 'all'
      ? data.todos
      : data.todos.filter(t => t.status !== 'done');

    // 按项目过滤：有 projectKey 时只显示该项目的 todos
    if (ctx.projectKey) {
      todos = todos.filter(t => t.projectKey === ctx.projectKey);
    }

    // 按 Agent 过滤：有 agentId 时，只显示分配给该 agent 或未分配的 todos
    if (ctx.agentId) {
      todos = todos.filter(t => !t.agentId || t.agentId === ctx.agentId);
    }

    if (todos.length === 0) {
      return {
        ref,
        content: MCP_GUIDE + '\n\n当前没有未完成的待办事项。',
        sectionTitle: 'AI 待办系统',
        ok: true,
      };
    }

    const lines = todos.map(t => {
      const pri = PRIORITY_LABELS[t.priority] || t.priority;
      const status = STATUS_LABELS[t.status] || t.status;
      let line = `- **${t.id}** [${status}][${pri}] ${t.title}`;
      if (t.description) line += `\n  ${t.description.replace(/\n/g, '\n  ')}`;
      return line;
    });

    const todoList = `### 当前待办（共 ${todos.length} 项）\n\n${lines.join('\n\n')}`;

    return {
      ref,
      content: MCP_GUIDE + '\n\n' + todoList,
      sectionTitle: 'AI 待办系统',
      ok: true,
    };
  }
}
