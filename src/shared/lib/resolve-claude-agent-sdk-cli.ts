/**
 * 解析 @anthropic-ai/claude-agent-sdk 自带的 cli.js 绝对路径，供 SDK 的 pathToClaudeCodeExecutable 使用。
 *
 * SDK 在未显式传入该路径时，会用自身 bundle 的 import.meta.url 去 resolve 同目录下的 ./cli.js。
 * 在 Bun/打包器把 SDK 打进单文件（如 dist/server/index.js）后，该 import.meta.url 不再落在包目录内，
 * 会误报「Native CLI binary for win32-x64 not found…」——此处从 node_modules 显式 resolve 可修复。
 *
 * 优先级：
 * 1. 环境变量 CLAUDE_AGENT_SDK_CLI_PATH（指向 cli.js）
 * 2. createRequire 自若干锚点解析 @anthropic-ai/claude-agent-sdk/cli.js
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let memo: string | null = null;

export function resolveClaudeAgentSdkCliJsPath(): string {
  if (memo) return memo;

  const envPath = process.env.CLAUDE_AGENT_SDK_CLI_PATH;
  if (envPath && existsSync(envPath)) {
    memo = envPath;
    return envPath;
  }

  const anchors: string[] = [];
  if (process.argv[1]) anchors.push(process.argv[1]);
  try {
    anchors.push(fileURLToPath(import.meta.url));
  } catch {
    // import.meta 不可用时忽略
  }
  anchors.push(join(process.cwd(), 'package.json'));

  const seen = new Set<string>();
  for (const anchor of anchors) {
    if (!anchor || seen.has(anchor)) continue;
    seen.add(anchor);
    try {
      const req = createRequire(anchor);
      // 包 exports 未导出 ./cli.js，只能从已解析的主入口目录拼接
      const mainEntry = req.resolve('@anthropic-ai/claude-agent-sdk');
      const resolved = join(dirname(mainEntry), 'cli.js');
      if (existsSync(resolved)) {
        memo = resolved;
        return resolved;
      }
    } catch {
      continue;
    }
  }

  throw new Error(
    '[resolveClaudeAgentSdkCliJsPath] 找不到 @anthropic-ai/claude-agent-sdk 的 cli.js。'
      + '请执行完整安装（勿对 Claude SDK 使用 --omit=optional），或设置环境变量 CLAUDE_AGENT_SDK_CLI_PATH 为 cli.js 的绝对路径。',
  );
}
