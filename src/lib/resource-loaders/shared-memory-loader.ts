/**
 * SharedMemoryLoader — injects shared memory (blackboard) contents into the prompt.
 *
 * When agents have shared memories written via the shared-memory CLI,
 * this loader renders them as a readable section in the system prompt.
 * Both project-scoped and global memories are included.
 *
 * ref.id is always '_shared'.
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { getMemorySummary } from '@/lib/shared-memory';

export class SharedMemoryLoader implements ResourceLoader {
  readonly type = 'shared-memory' as const;

  async resolve(ref: ResourceRef, ctx: LoaderContext): Promise<ResolvedResource> {
    const summary = await getMemorySummary(ctx.projectKey);

    if (!summary) {
      return { ref, content: '', ok: true };
    }

    const md = `以下是其他 Agent 留下的共享记忆，你可以参考这些信息来辅助决策。

${summary}

### 读写共享记忆

**推荐**：若当前 Agent 已开启 **「注册表 MCP」**（\`registryMcp\`），请使用 MCP 服务器 **projectpilot-registry** 的工具 \`memory_list\` / \`memory_read\` / \`memory_write\` / \`memory_delete\`（\`scope=project|global\`），勿依赖 Bash。

无该能力时可用 CLI（需在 PP 应用代码根执行）：

\`\`\`bash
npx tsx src/lib/shared-memory.ts write --key "键名" --value "内容" [--project <项目key>] [--ttl <小时数>]
npx tsx src/lib/shared-memory.ts read --key "键名" [--project <项目key>]
npx tsx src/lib/shared-memory.ts list [--project <项目key>]
npx tsx src/lib/shared-memory.ts delete --key "键名" [--project <项目key>]
\`\`\`

**使用建议**：当你发现了对其他 Agent 有价值的信息（如架构决策、调试发现、环境问题等），主动写入共享记忆。临时信息设置 TTL（MCP 的 \`ttlHours\` 或 CLI 的 \`--ttl\`）。
`;

    return {
      ref,
      content: md,
      sectionTitle: 'Agent 共享记忆',
      ok: true,
    };
  }
}
