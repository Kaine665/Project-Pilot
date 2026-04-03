/**
 * AgentDataInfoLoader — 列出 Agent 私有工作区目录内已有文件（动态）。
 *
 * 路径约定与 **全局约束**（\`global-prompt\` / \`prompts/global.md\`）中的「Agent 数据工作区（磁盘约定）」一节一致。
 *
 * ref.id = agentId（通常从 ctx.agentId 获取）。
 * 仅在 Agent 开启 dataStore 能力时才会注入此资源。
 */

import { promises as fs } from 'fs';
import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { getAgentDataPath } from '@/lib/file-store';

export class AgentDataInfoLoader implements ResourceLoader {
  readonly type = 'agent-data-info' as const;

  async resolve(ref: ResourceRef, ctx: LoaderContext): Promise<ResolvedResource> {
    const agentId = ref.id || ctx.agentId;
    if (!agentId) {
      return { ref, content: '', ok: false };
    }

    const dataDir = getAgentDataPath(agentId);

    // 确保目录存在
    await fs.mkdir(dataDir, { recursive: true });

    // 列出目录内文件
    let files: string[] = [];
    try {
      const entries = await fs.readdir(dataDir, { withFileTypes: true });
      files = entries.filter(e => e.isFile()).map(e => e.name);
    } catch {
      // 目录读取失败不阻塞
    }

    let md = `你的专属数据目录：\`${dataDir}\`\n`;
    md += '你可以在此目录下自由读写文件（bash cat/echo/node 等），不会触发安全告警。\n';

    if (files.length > 0) {
      md += '\n已有文件：\n| 文件名 | 大小 |\n|--------|------|\n';
      for (const name of files) {
        try {
          const stat = await fs.stat(`${dataDir}/${name}`);
          const size = stat.size < 1024
            ? `${stat.size} B`
            : `${(stat.size / 1024).toFixed(1)} KB`;
          md += `| ${name} | ${size} |\n`;
        } catch {
          md += `| ${name} | - |\n`;
        }
      }
      md += `\n（共 ${files.length} 个文件）`;
    } else {
      md += '\n目录为空，尚无文件。';
    }

    return {
      ref,
      content: md,
      sectionTitle: 'Agent 私有数据存储',
      ok: true,
    };
  }
}
