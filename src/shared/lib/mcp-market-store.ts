/**
 * 社区商店安装的 MCP 服务定义，合并进 Claude 启动时的 --mcp-config。
 * 文件：`{DATA_DIR}/config/mcp-market.json`，形状与项目根 `.mcp.json` 一致：`{ mcpServers: { ... } }`。
 *
 * 首次启动且该文件尚不存在时，会落盘一份常用 MCP 组合（见 `default-mcp-market.json`），避免「零配置却没有任何工具」。
 */
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { getDataDir, modifyJsonFile, notifyDataChanged } from '@/lib/file-store';
import { mergeMcpServersForSpawn } from '@/lib/mcp-market-ui-shared';
import defaultMcpMarket from '@/data/default-mcp-market.json';

export function getMcpMarketPath(): string {
  return path.join(getDataDir(), 'config', 'mcp-market.json');
}

type DefaultMcpMarketFile = { mcpServers?: Record<string, unknown> };

/** 兼容不同打包器对 JSON 默认导出的差异（`{ mcpServers }` 或 `{ default: { mcpServers } }`）。 */
function resolvedDefaultMcpBundle(): DefaultMcpMarketFile {
  const mod = defaultMcpMarket as DefaultMcpMarketFile & { default?: DefaultMcpMarketFile };
  if (mod?.default?.mcpServers && typeof mod.default.mcpServers === 'object') {
    return mod.default;
  }
  if (mod?.mcpServers && typeof mod.mcpServers === 'object') {
    return mod;
  }
  console.warn('[mcp-market] default-mcp-market.json import shape unexpected; using inline fallback');
  return {
    mcpServers: {
      'pp-bundled-memory': {
        enabled: true,
        description: '本地结构化记忆：用知识图谱方式存实体与关系，适合跨会话记住约定与事实。',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
      },
      'pp-bundled-sequential-thinking': {
        enabled: true,
        description: '分步推理：把复杂问题拆成多步思考链，便于梳理逻辑再执行。',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
      },
      'pp-bundled-playwright': {
        enabled: true,
        description: '浏览器自动化：可驱动页面操作与验证；首次运行 npx 可能下载浏览器，体积较大。',
        command: 'npx',
        args: ['-y', '@playwright/mcp'],
      },
    },
  };
}

/**
 * 若 `mcp-market.json` 不存在，则写入内置默认条目（Memory、Sequential Thinking、Playwright）。
 * 已存在文件则不覆盖，避免冲掉用户自定义或已卸载后的空文件意图。
 */
export async function ensureDefaultMcpMarketSeeded(): Promise<void> {
  const p = getMcpMarketPath();
  try {
    await fs.promises.access(p);
    return;
  } catch {
    /* 不存在则创建 */
  }
  try {
    const bundle = resolvedDefaultMcpBundle();
    const text = JSON.stringify(bundle, null, 2);
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    await fs.promises.writeFile(p, `${text}\n`, 'utf-8');
  } catch (e) {
    console.error('[mcp-market] ensureDefaultMcpMarketSeeded failed:', e);
  }
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
 * 返回传给 `claude --mcp-config` 的路径：合并市场与项目 `.mcp.json`，
 * 去掉停用的条目并剥离 `enabled` 元数据后写入临时 JSON（与「仅返回单文件路径」相比，行为一致且支持停用）。
 */
export function resolveMcpConfigPathForSpawn(workingDir: string): string | undefined {
  const projectPath = path.join(workingDir, '.mcp.json');
  const marketPath = getMcpMarketPath();
  const project = readJsonIfExistsSync(projectPath);
  const market = readJsonIfExistsSync(marketPath);
  const pServers = project?.mcpServers as Record<string, unknown> | undefined;
  const mServers = market?.mcpServers as Record<string, unknown> | undefined;
  const merged = mergeMcpServersForSpawn(mServers, pServers);
  if (Object.keys(merged).length === 0) return undefined;
  const tmp = path.join(tmpdir(), `pp-mcp-${process.pid}-${randomBytes(8).toString('hex')}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ mcpServers: merged }, null, 2), 'utf-8');
  return tmp;
}

/**
 * 读取当前 `mcp-market.json`（会先确保默认文件已落盘）。
 * 供 UI 展示已安装的 MCP 条目。
 */
export async function readMcpMarketFile(): Promise<McpFileShape> {
  try {
    await ensureDefaultMcpMarketSeeded();
  } catch (e) {
    console.error('[mcp-market] readMcpMarketFile: seed step failed:', e);
  }
  const p = getMcpMarketPath();
  try {
    const raw = await fs.promises.readFile(p, 'utf-8');
    return JSON.parse(raw) as McpFileShape;
  } catch {
    return { mcpServers: {} };
  }
}

export async function listMcpMarketServerKeys(): Promise<string[]> {
  await ensureDefaultMcpMarketSeeded();
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
  await ensureDefaultMcpMarketSeeded();
  await modifyJsonFile<McpFileShape>(getMcpMarketPath(), { mcpServers: {} }, (prev) => ({
    mcpServers: {
      ...(prev.mcpServers ?? {}),
      [serverKey]: serverConfig,
    },
  }));
}

const MCP_SERVER_KEY_RE = /^[a-zA-Z0-9_-]{1,80}$/;

export function assertValidMcpServerKey(key: string): string {
  const k = key.trim();
  if (!MCP_SERVER_KEY_RE.test(k)) {
    throw new Error('invalid_server_key');
  }
  return k;
}

/** 从 `mcp-market.json` 移除单个服务键。 */
export async function removeMcpServerFromMarket(serverKey: string): Promise<void> {
  const safe = assertValidMcpServerKey(serverKey);
  await ensureDefaultMcpMarketSeeded();
  await modifyJsonFile<McpFileShape>(getMcpMarketPath(), { mcpServers: {} }, (prev) => {
    const next = { ...(prev.mcpServers ?? {}) };
    delete next[safe];
    return { mcpServers: next };
  });
  await notifyDataChanged().catch(() => {});
}

/** 写入或覆盖单个服务配置（`config` 须为 JSON 对象，非数组）。 */
export async function updateMcpServerInMarket(serverKey: string, config: unknown): Promise<void> {
  const safe = assertValidMcpServerKey(serverKey);
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('config_must_be_object');
  }
  await ensureDefaultMcpMarketSeeded();
  await modifyJsonFile<McpFileShape>(getMcpMarketPath(), { mcpServers: {} }, (prev) => ({
    mcpServers: {
      ...(prev.mcpServers ?? {}),
      [safe]: config,
    },
  }));
  await notifyDataChanged().catch(() => {});
}

/** 仅更新 `enabled` 开关，其余字段不变。 */
export async function setMcpServerEnabledInMarket(serverKey: string, enabled: boolean): Promise<void> {
  const safe = assertValidMcpServerKey(serverKey);
  if (typeof enabled !== 'boolean') {
    throw new Error('enabled_must_be_boolean');
  }
  await ensureDefaultMcpMarketSeeded();
  await modifyJsonFile<McpFileShape>(getMcpMarketPath(), { mcpServers: {} }, (prev) => {
    const cur = prev.mcpServers?.[safe];
    if (cur === undefined) {
      throw new Error('server_not_found');
    }
    if (typeof cur !== 'object' || cur === null || Array.isArray(cur)) {
      throw new Error('entry_not_object');
    }
    return {
      mcpServers: {
        ...(prev.mcpServers ?? {}),
        [safe]: { ...(cur as Record<string, unknown>), enabled },
      },
    };
  });
  await notifyDataChanged().catch(() => {});
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
