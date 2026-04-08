/**
 * 社区商店安装的 MCP 服务定义，合并进 Claude 启动时的 --mcp-config。
 * 文件：`{DATA_DIR}/config/mcp-market.json`，形状与项目根 `.mcp.json` 一致：`{ mcpServers: { ... } }`。
 */
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { getDataDir, modifyJsonFile } from '@/lib/file-store';

export function getMcpMarketPath(): string {
  return path.join(getDataDir(), 'config', 'mcp-market.json');
}

type McpFileShape = { mcpServers?: Record<string, unknown> };

function readJsonIfExistsSync(p: string): McpFileShape | null {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as McpFileShape;
  } catch {
    return null;
  }
}

/**
 * 返回传给 `claude --mcp-config` 的路径：仅项目、仅市场、或临时合并文件（市场先展开，项目同名覆盖）。
 */
export function resolveMcpConfigPathForSpawn(workingDir: string): string | undefined {
  const projectPath = path.join(workingDir, '.mcp.json');
  const marketPath = getMcpMarketPath();
  const project = readJsonIfExistsSync(projectPath);
  const market = readJsonIfExistsSync(marketPath);
  const pServers = project?.mcpServers;
  const mServers = market?.mcpServers;
  const hasP = pServers && Object.keys(pServers).length > 0;
  const hasM = mServers && Object.keys(mServers).length > 0;
  if (!hasP && !hasM) return undefined;
  if (hasP && !hasM) return projectPath;
  if (!hasP && hasM) return marketPath;
  const merged = {
    mcpServers: {
      ...(mServers as Record<string, unknown>),
      ...(pServers as Record<string, unknown>),
    },
  };
  const tmp = path.join(tmpdir(), `pp-mcp-${process.pid}-${randomBytes(8).toString('hex')}.json`);
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf-8');
  return tmp;
}

export async function listMcpMarketServerKeys(): Promise<string[]> {
  const p = getMcpMarketPath();
  if (!fs.existsSync(p)) return [];
  try {
    const raw = await fs.promises.readFile(p, 'utf-8');
    const j = JSON.parse(raw) as McpFileShape;
    return Object.keys(j.mcpServers ?? {});
  } catch {
    return [];
  }
}

export async function installMcpServerToMarket(serverKey: string, serverConfig: unknown): Promise<void> {
  await modifyJsonFile<McpFileShape>(getMcpMarketPath(), { mcpServers: {} }, (prev) => ({
    mcpServers: {
      ...(prev.mcpServers ?? {}),
      [serverKey]: serverConfig,
    },
  }));
}

/** 将模板中的 {{PROJECT_PATH}} 替换为实际路径（JSON 序列化后替换再解析）。 */
export function applyProjectPathTemplate(config: unknown, projectPath: string): unknown {
  const s = JSON.stringify(config);
  if (!s.includes('{{PROJECT_PATH}}')) return config;
  const replaced = s.split('{{PROJECT_PATH}}').join(projectPath.replace(/\\/g, '/'));
  try {
    return JSON.parse(replaced) as unknown;
  } catch {
    return config;
  }
}
