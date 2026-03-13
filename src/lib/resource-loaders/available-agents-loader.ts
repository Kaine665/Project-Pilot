/**
 * AvailableAgentsLoader — renders the list of agents callable via sub-agent invocation.
 *
 * When an agent has `subAgent: true`, this resource injects a table of
 * other available agents and instructions on how to invoke them via
 * the call-agent CLI tool.
 *
 * ref.id is always '_callable'.
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { getAgentsPath, readJsonFile } from '@/lib/file-store';
import type { AgentsData, Agent, AgentCapabilities } from '@/types';
import { DEFAULT_AGENTS } from '@/lib/default-agents';

export class AvailableAgentsLoader implements ResourceLoader {
  readonly type = 'available-agents' as const;

  async resolve(ref: ResourceRef, ctx: LoaderContext): Promise<ResolvedResource> {
    const data = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });

    // Ensure built-in agents are included (same merge logic as agents API route)
    for (const defaultAgent of DEFAULT_AGENTS) {
      if (!data.agents.some(a => a.id === defaultAgent.id)) {
        data.agents.unshift(defaultAgent);
      }
    }

    // Filter: non-archived, exclude self
    const callable = data.agents.filter(a => !a.archived && a.id !== ctx.agentId);

    if (callable.length === 0) {
      return { ref, content: '', ok: true };
    }

    const summarizeCaps = (caps?: AgentCapabilities): string => {
      if (!caps) return '默认';
      const parts: string[] = [];
      if (caps.bash) parts.push('bash');
      if (caps.fileAccess) parts.push('文件');
      if (caps.web) parts.push('网络');
      if (caps.subAgent) parts.push('子Agent');
      return parts.join(', ') || '聊天';
    };

    const tableHeader = '| 名称 | Agent ID | 描述 | 能力 |\n|------|----------|------|------|';
    const toRow = (a: Agent) => {
      const desc = a.description ? a.description.slice(0, 60) : '-';
      const caps = summarizeCaps(a.capabilities);
      return `| ${a.name} | \`${a.id}\` | ${desc} | ${caps} |`;
    };

    // 收集有 triggerHints 的 Agent，生成"何时找我"黄页
    const agentsWithHints = callable.filter(a => a.triggerHints && a.triggerHints.length > 0);
    let hintsSection = '';
    if (agentsWithHints.length > 0) {
      const lines = agentsWithHints.map(a => {
        const hints = a.triggerHints!.map(h => `  - ${h}`).join('\n');
        return `- **${a.name}** (\`${a.id}\`):\n${hints}`;
      });
      hintsSection = `\n### 何时找谁（Agent 黄页）\n\n以下场景建议主动调用对应 Agent：\n\n${lines.join('\n')}\n`;
    }

    const md = `你可以通过 \`call-agent\` CLI 调用以下 Agent 来协助完成子任务。

${tableHeader}
${callable.map(toRow).join('\n')}
${hintsSection}

### 输出格式

所有模式的 stdout 都输出**结构化 JSON**（一行），便于机器解析：

\`\`\`
同步完成: {"status":"completed","sessionId":"...","content":"..."}
异步启动: {"status":"started","sessionId":"..."}
轮询完成: {"status":"completed","sessionId":"...","content":"..."}
轮询运行中: {"status":"running","sessionId":"..."}
失败:     {"status":"failed","sessionId":"...","error":"..."}
\`\`\`

### 同步调用（默认，等待完成）

\`\`\`bash
cd "$PROJECT_ROOT" && npx tsx src/lib/call-agent.ts \\
  --agent-id <AGENT_ID> \\
  --message "你的指令" \\
  [--project <PROJECT_KEY>] \\
  [--parent-session <当前会话ID>] \\
  [--timeout 300] \\
  [--depth <当前深度+1>]
\`\`\`

### 异步调用（委派后继续工作）

当你不需要立即获取结果时，使用异步模式。适合耗时任务或可并行的委托。

\`\`\`bash
# 1. 发起异步调用（返回 JSON，从中提取 sessionId）
ASYNC_RESULT=$(cd "$PROJECT_ROOT" && npx tsx src/lib/call-agent.ts \\
  --agent-id <AGENT_ID> \\
  --message "你的指令" \\
  --async \\
  [--project <PROJECT_KEY>] \\
  [--depth <当前深度+1>])
# ASYNC_RESULT = {"status":"started","sessionId":"xxx"}

# 2. 继续做你自己的事...

# 3. 稍后检查结果（exit 0=完成, 2=仍在运行, 1=失败）
POLL_RESULT=$(cd "$PROJECT_ROOT" && npx tsx src/lib/call-agent.ts --poll <sessionId>)
# POLL_RESULT = {"status":"completed","sessionId":"xxx","content":"..."}
\`\`\`

**何时用异步**：当子任务独立且你有其他事可做时（如委派审查、并行调研）。
**何时用同步**：当你需要子 Agent 的结果才能继续下一步时。

### 参数说明

- \`--agent-id\`：必填，目标 Agent 的 ID
- \`--message\`：必填，发送给子 Agent 的指令
- \`--async\`：异步模式，立即返回 sessionId
- \`--poll <sessionId>\`：查询异步调用的状态和结果
- \`--project\`：可选，为子 Agent 设定项目上下文
- \`--parent-session\`：可选，将子会话关联到当前会话（推荐传入）
- \`--timeout\`：可选，超时秒数（默认 300 秒，仅同步模式）
- \`--depth\`：可选，调用深度（递归保护，默认 0，上限 3）
- \`$PROJECT_ROOT\` 是 ProjectPilot 项目根目录
`;

    return {
      ref,
      content: md,
      sectionTitle: '可调用 Agent 列表',
      ok: true,
    };
  }
}
