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

    const md = `你可以通过 \`call-agent\` CLI 调用以下 Agent 来协助完成子任务。

${tableHeader}
${callable.map(toRow).join('\n')}

### 调用方式

\`\`\`bash
cd "$PROJECT_ROOT" && npx tsx src/lib/call-agent.ts \\
  --agent-id <AGENT_ID> \\
  --message "你的指令" \\
  [--project <PROJECT_KEY>] \\
  [--parent-session <当前会话ID>] \\
  [--timeout 300] \\
  [--depth <当前深度+1>]
\`\`\`

- \`--agent-id\`：必填，目标 Agent 的 ID
- \`--message\`：必填，发送给子 Agent 的指令
- \`--project\`：可选，为子 Agent 设定项目上下文
- \`--parent-session\`：可选，将子会话关联到当前会话（推荐传入）
- \`--timeout\`：可选，超时秒数（默认 300 秒）
- \`--depth\`：可选，调用深度（用于递归保护，默认 0，上限 3）
- 调用完成后，子 Agent 的完整回复文本会输出到 stdout
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
