/**
 * 静态说明：设计/知识文档请用进程内 MCP **projectpilot-documents**（capabilities.documentsMcp）。
 * Resource type 仍为 `doc-save-instructions`，与包清单、迁移逻辑兼容。
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { AGENT_DOCUMENTS_MCP_SERVER_KEY } from '@/lib/agent-documents-mcp-server';

const BODY = `### 文档库（优先使用 MCP）

若当前 Agent 已开启 **documentsMcp**，本会话会注册 MCP 服务器 **${AGENT_DOCUMENTS_MCP_SERVER_KEY}**。请用下列**结构化工具**读写文档，**不要**再输出已废弃的 \`<save-doc>\` 等标签。

| 工具 | 用途 |
|------|------|
| \`doc_list\` | 列出条目（可选 \`projectKey\`、\`documentKind\`：\`design_doc\` / \`knowledge\`、\`status\`） |
| \`doc_get\` | 按 \`id\` 读取元数据与正文（Markdown） |
| \`doc_create\` | 新建（\`title\` 必填；知识类须 \`documentKind: knowledge\`） |
| \`doc_update\` | 更新元数据与/或正文 |
| \`doc_delete\` | 删除 |

无会话项目时，\`doc_list\` / \`doc_create\` 等须**显式传** \`projectKey\`（与参数校验一致）。

（REST \`/api/docs\` 供应用前端使用；Agent 侧请只用上述 MCP。）`;

export class DocumentsMcpInstructionsLoader implements ResourceLoader {
  readonly type = 'doc-save-instructions' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    return {
      ref,
      content: BODY,
      sectionTitle: '文档库 MCP',
      ok: true,
    };
  }
}
