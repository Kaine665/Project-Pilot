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

const API_GUIDE = `### Todo API

基础 URL: \`http://localhost:4000/api/todos\`

| 操作 | 方法 | 路径 | 请求体 |
|------|------|------|--------|
| 列表 | GET | /api/todos | — |
| 新建 | POST | /api/todos | \`{ title, description?, priority?, projectKey? }\` |
| 更新 | PATCH | /api/todos/:id | \`{ title?, description?, status?, priority?, projectKey? }\` |
| 删除 | DELETE | /api/todos/:id | — |

字段说明：
- **status**: \`pending\` / \`in_progress\` / \`done\`
- **priority**: \`high\` / \`medium\` / \`low\`
- **id** 格式: \`todo-{timestamp}\`（创建时自动生成）

使用示例（Bash）:
\`\`\`bash
# 标记为进行中
curl -s -X PATCH http://localhost:4000/api/todos/todo-123 -H "Content-Type: application/json" -d '{"status":"in_progress"}'

# 标记为完成
curl -s -X PATCH http://localhost:4000/api/todos/todo-123 -H "Content-Type: application/json" -d '{"status":"done"}'

# 新建待办
curl -s -X POST http://localhost:4000/api/todos -H "Content-Type: application/json" -d '{"title":"…","priority":"high"}'
\`\`\``;

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
        content: API_GUIDE + '\n\n当前没有未完成的待办事项。',
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

    const STATUS_GUIDE = `### 任务状态管理

当你完成了某个待办任务后，请主动更新其状态：
\`\`\`bash
curl -s -X PATCH http://localhost:4000/api/todos/<todo-id> -H "Content-Type: application/json" -d '{"status":"done"}'
\`\`\`
如果你开始处理某个待办，先将其标记为进行中：
\`\`\`bash
curl -s -X PATCH http://localhost:4000/api/todos/<todo-id> -H "Content-Type: application/json" -d '{"status":"in_progress"}'
\`\`\``;

    return {
      ref,
      content: API_GUIDE + '\n\n' + todoList + '\n\n' + STATUS_GUIDE,
      sectionTitle: 'AI 待办系统',
      ok: true,
    };
  }
}
