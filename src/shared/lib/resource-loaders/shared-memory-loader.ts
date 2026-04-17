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

\`\`\`bash
# 写入（同 key 会覆盖）
npx tsx src/lib/shared-memory.ts write --key "键名" --value "内容" [--project <项目key>] [--author "你的名字"] [--ttl <小时数>]

# 读取
npx tsx src/lib/shared-memory.ts read --key "键名" [--project <项目key>]

# 列表
npx tsx src/lib/shared-memory.ts list [--project <项目key>]

# 删除
npx tsx src/lib/shared-memory.ts delete --key "键名" [--project <项目key>]
\`\`\`

**使用建议**：当你发现了对其他 Agent 有价值的信息（如架构决策、调试发现、环境问题等），主动写入共享记忆。临时信息设置 TTL（如 \`--ttl 24\` = 24小时后过期）。
`;

    return {
      ref,
      content: md,
      sectionTitle: 'Agent 共享记忆',
      ok: true,
    };
  }
}
