/**
 * SettingsManager — 全局设置读写 + Claude CLI 环境构建。
 *
 * 缓存策略：30s TTL 内存缓存，saveSettings 后立即失效。
 * 优先级：系统环境变量 > App 设置 > 默认值。
 */

import { getSettingsPath, readJsonFile, writeJsonFile } from '@/lib/file-store';
import { getProviderPreset } from '@/lib/provider-registry';
import type { AgentCapabilities, AppSettings, ClaudeSettings, ProviderId, SessionPhase } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES, DEFAULT_APP_SETTINGS } from '@/types';

const CACHE_TTL_MS = 30_000;

let cachedSettings: AppSettings | null = null;
let cacheTimestamp = 0;

export async function getSettings(): Promise<AppSettings> {
  const now = Date.now();
  if (cachedSettings && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedSettings;
  }
  cachedSettings = await readJsonFile<AppSettings>(getSettingsPath(), DEFAULT_APP_SETTINGS);
  cacheTimestamp = now;
  return cachedSettings;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await writeJsonFile(getSettingsPath(), settings);
  invalidateCache();
}

export function invalidateCache(): void {
  cachedSettings = null;
  cacheTimestamp = 0;
}

// ── Per-provider scoped helpers ──

/**
 * 获取指定供应商的 API Key。
 * 优先级：providerApiKeys[provider] > 旧的 flat apiKey（仅 anthropic 时回退）
 */
export function getProviderScopedApiKey(claude: ClaudeSettings, provider?: ProviderId): string | undefined {
  const p = provider ?? claude.provider ?? 'anthropic';
  const scoped = claude.providerApiKeys?.[p];
  if (scoped) return scoped;
  // 向后兼容：旧数据只有 flat apiKey，仅 anthropic 时回退
  if (p === 'anthropic' && claude.apiKey) return claude.apiKey;
  return undefined;
}

/**
 * 获取指定供应商的模型 ID。
 * 优先级：providerModels[provider] > 旧的 flat model
 */
export function getProviderScopedModel(claude: ClaudeSettings, provider?: ProviderId): string {
  const p = provider ?? claude.provider ?? 'anthropic';
  const scoped = claude.providerModels?.[p];
  if (scoped) return scoped;
  return claude.model;
}

/**
 * 构造 Claude CLI 的 env 对象。
 *
 * 注入逻辑（按供应商区分）：
 *
 * anthropic（官方）:
 *   - ANTHROPIC_API_KEY: authMode=api_key 时注入
 *   - ANTHROPIC_BASE_URL: 仅当用户填了自定义 URL 时注入
 *
 * 第三方供应商（deepseek/qwen/zhipu/minimax/openrouter/ollama/custom）:
 *   - ANTHROPIC_BASE_URL: 从 preset 或用户自定义中取
 *   - ANTHROPIC_AUTH_TOKEN: 用 apiKey 注入（第三方用 auth token 而非 api key）
 *   - ANTHROPIC_API_KEY: 设为空字符串，防止 Claude CLI 回落到 Anthropic
 *   - 额外 env: 从 preset.extraEnv 注入（如 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC）
 *
 * 所有供应商共同：
 *   - FORCE_COLOR / CLAUDECODE: 始终覆盖
 *   - CLAUDE_CODE_EFFORT_LEVEL: 非 high 时注入
 */
export async function buildClaudeEnv(): Promise<NodeJS.ProcessEnv> {
  const settings = await getSettings();
  const claude = settings.claude;
  const provider = claude.provider ?? 'anthropic';
  const preset = getProviderPreset(provider);

  const env: NodeJS.ProcessEnv = { ...process.env };

  const scopedKey = getProviderScopedApiKey(claude, provider);

  if (provider === 'anthropic' || provider === 'openai') {
    // 官方供应商（Anthropic / OpenAI）：API Key 或 OAuth
    if (claude.authMode === 'api_key' && scopedKey && !process.env.ANTHROPIC_API_KEY) {
      env.ANTHROPIC_API_KEY = scopedKey;
    }
    if (claude.baseUrl && !process.env.ANTHROPIC_BASE_URL) {
      env.ANTHROPIC_BASE_URL = claude.baseUrl;
    }
  } else {
    // 第三方供应商
    const baseUrl = claude.baseUrl || preset.baseUrl;
    if (baseUrl && !process.env.ANTHROPIC_BASE_URL) {
      env.ANTHROPIC_BASE_URL = baseUrl;
    }

    // 第三方用 AUTH_TOKEN 认证，同时把 API_KEY 设为空字符串
    if (scopedKey && !process.env.ANTHROPIC_AUTH_TOKEN) {
      env.ANTHROPIC_AUTH_TOKEN = scopedKey;
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      env.ANTHROPIC_API_KEY = '';
    }

    // 供应商额外环境变量
    if (preset.extraEnv) {
      for (const [key, val] of Object.entries(preset.extraEnv)) {
        if (!process.env[key]) {
          env[key] = val;
        }
      }
    }
  }

  // 推理努力等级
  if (claude.effortLevel && claude.effortLevel !== 'high' && !process.env.CLAUDE_CODE_EFFORT_LEVEL) {
    env.CLAUDE_CODE_EFFORT_LEVEL = claude.effortLevel;
  }

  env.FORCE_COLOR = '0';
  env.CLAUDECODE = '';

  return env;
}

/**
 * 构造 --model CLI 参数。
 * 返回 ['--model', modelId] 或 []。
 */
export async function buildClaudeModelArgs(): Promise<string[]> {
  const settings = await getSettings();
  const model = getProviderScopedModel(settings.claude);
  if (!model) return [];
  return ['--model', model];
}

/**
 * 构造 --max-turns CLI 参数。
 * 返回 ['--max-turns', 'N'] 或 []。
 */
export async function buildClaudeMaxTurnsArgs(): Promise<string[]> {
  const settings = await getSettings();
  const maxTurns = settings.claude.maxTurns;
  if (!maxTurns || maxTurns <= 0) return [];
  return ['--max-turns', String(maxTurns)];
}

/**
 * 根据 phase + 全局设置构造权限参数。
 *
 * - skipPermissions=true（默认）：有工具权限的阶段返回 ['--dangerously-skip-permissions']
 * - skipPermissions=false：始终返回 []，所有工具调用需用户审批
 *
 * understanding/branching 阶段始终不传该参数（无论设置如何）。
 */
export async function buildClaudePermissionArgs(phase: SessionPhase | undefined): Promise<string[]> {
  const effective = phase ?? 'understanding';

  if (effective === 'branching' || effective === 'understanding') {
    return [];
  }

  const settings = await getSettings();
  const skip = settings.claude.skipPermissions !== false;
  return skip ? ['--dangerously-skip-permissions'] : [];
}

// ── Agent capability → CLI args ──

/** Maps capability keys to Claude Code tool names accepted by --allowedTools */
const CAPABILITY_TOOL_MAP: Record<string, string[]> = {
  bash: ['Bash'],
  fileAccess: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit'],
  web: ['WebFetch', 'WebSearch'],
  subAgent: ['Task', 'TaskOutput', 'TaskStop'],
};

/** Meta tools that should always be available regardless of capability settings */
const META_TOOLS = [
  'EnterPlanMode', 'ExitPlanMode',
  'TodoWrite',
  'AskUserQuestion',
  'EnterWorktree',
  'Skill',
];

/**
 * 根据 Agent 能力配置构造 --allowedTools 参数。
 *
 * - 全部工具能力开启 → 返回 []（不限制）
 * - 部分开启 → 返回 ['--allowedTools', 'Tool1,Tool2,...']
 * - 全部关闭 → 返回 ['--allowedTools', '']（纯聊天模式）
 */
export function buildAgentToolArgs(capabilities: AgentCapabilities | undefined): string[] {
  const caps = capabilities ?? DEFAULT_AGENT_CAPABILITIES;

  const toolCapKeys = ['bash', 'fileAccess', 'web', 'subAgent'] as const;
  const allEnabled = toolCapKeys.every(k => caps[k]);
  if (allEnabled) return [];

  const allowed: string[] = [...META_TOOLS];
  for (const key of toolCapKeys) {
    if (caps[key]) {
      allowed.push(...CAPABILITY_TOOL_MAP[key]);
    }
  }

  return ['--allowedTools', allowed.join(',')];
}

/**
 * 根据 phase + Agent 能力配置构造权限参数。
 *
 * - understanding/branching 阶段始终不传
 * - Agent skipReview=false → 不传（需审核）
 * - Agent skipReview=true + 全局 skipPermissions=true → 传 --dangerously-skip-permissions
 */
export async function buildAgentPermissionArgs(
  phase: SessionPhase | undefined,
  capabilities: AgentCapabilities | undefined,
): Promise<string[]> {
  const effective = phase ?? 'understanding';

  if (effective === 'branching' || effective === 'understanding') {
    return [];
  }

  const caps = capabilities ?? DEFAULT_AGENT_CAPABILITIES;
  if (!caps.skipReview) return [];

  const settings = await getSettings();
  const skip = settings.claude.skipPermissions !== false;
  return skip ? ['--dangerously-skip-permissions'] : [];
}
