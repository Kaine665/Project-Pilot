/**
 * 依赖本机数据路径的 prompt 片段（仅 Hono / AgentChatManager 等 Node 端使用）。
 * 与 {@link ./agent-provider-capabilities} 拆分，避免客户端 bundle 静态拉取 `file-store` / `fs`。
 */

import path from 'path';

import type { AgentCapabilities } from '@/types';
import { getAgentDataPath, getDataDir } from '@/lib/file-store';

/**
 * 注入本机数据目录与当前 Agent 工作区绝对路径（进程内「伪 MCP」：只加提示，不另起协议）。
 * 减少模型臆造 `~/.project-pilot`、`/root/.project-pilot` 等与真实磁盘不一致的路径。
 */
export function appendAgentWorkspacePathNotice(prompt: string, agentId: string, caps: AgentCapabilities): string {
  if (!caps.fileAccess && !caps.dataStore) return prompt;

  const dataRoot = path.normalize(getDataDir());
  const workspaceRoot = path.normalize(getAgentDataPath(agentId));
  const posixData = dataRoot.replace(/\\/g, '/');
  const posixWs = workspaceRoot.replace(/\\/g, '/');

  const notice = `---
## 本机路径（系统自动附加，写入文件时请优先使用）
- **产品数据根（PROJECT_PILOT 数据目录）**：\`${dataRoot}\`（POSIX 风格便于 Bash：\`${posixData}\`）
- **当前 Agent 私有工作区根**（Write/终端写入用户数据时的首选根目录）：\`${workspaceRoot}\`（POSIX：\`${posixWs}\`）
- 工作区下可有任意子目录（例如 \`data/\`）；**不要使用** Linux 容器里的 \`/root/\` 路径，除非确认当前 Shell 就在该环境中。`;

  return `${prompt}\n\n${notice}\n`;
}
