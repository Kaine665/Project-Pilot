/**
 * SettingsManager — 全局设置读写 + Claude CLI 环境构建。
 *
 * 缓存策略：30s TTL 内存缓存，saveSettings 后立即失效。
 * 优先级：系统环境变量 > App 设置 > 默认值。
 */

import { getSettingsPath, readJsonFile, writeJsonFile } from '@/lib/file-store';
import { getKimiCandidateBaseUrls, getProviderPreset } from '@/lib/provider-registry';
import type { AgentCapabilities, AppSettings, ClaudeSettings, CustomProviderConfig, ProviderId } from '@/types';
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
 * 优先级：providerApiKeys[provider] > 自定义供应商.apiKey > 旧的 flat apiKey（仅 anthropic 时回退）
 */
export function getProviderScopedApiKey(claude: ClaudeSettings, provider?: ProviderId): string | undefined {
  const p = provider ?? claude.provider ?? 'anthropic';
  const scoped = claude.providerApiKeys?.[p];
  if (scoped) return scoped;
  // 自定义供应商：从 customProvider.apiKey 取
  if (p.startsWith('custom-') && claude.customProviders) {
    const cp = claude.customProviders.find((c) => c.id === p);
    if (cp?.apiKey) return cp.apiKey;
  }
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
 * 获取指定供应商的 baseUrl。
 * 优先级：providerBaseUrls[provider] > 全局 baseUrl > preset.baseUrl
 */
export function getProviderScopedBaseUrl(
  claude: ClaudeSettings,
  preset: { baseUrl?: string },
  provider?: ProviderId,
  modelOverride?: string,
): string | undefined {
  const p = provider ?? claude.provider ?? 'anthropic';
  const scoped = claude.providerBaseUrls?.[p];
  if (p === 'kimi') {
    const modelId = (modelOverride ?? getProviderScopedModel(claude, p)).trim();
    const preferred = scoped || claude.baseUrl || preset.baseUrl;
    const kimiCandidates = getKimiCandidateBaseUrls(modelId, preferred);
    if (kimiCandidates.length > 0) {
      return kimiCandidates[0];
    }
  }
  if (scoped) return scoped;
  if (claude.baseUrl) return claude.baseUrl;
  return preset.baseUrl;
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
export async function buildClaudeEnv(
  providerOverride?: ProviderId,
  effortOverride?: string,
  modelOverride?: string,
): Promise<NodeJS.ProcessEnv> {
  const settings = await getSettings();
  const claude = settings.claude;
  const provider = providerOverride ?? claude.provider ?? 'anthropic';
  const preset = getProviderPreset(provider, claude.customProviders);

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
    // 第三方供应商（优先使用 providerBaseUrls，如 Kimi 探测后持久化的 URL）
    // 强制覆盖，不受系统环境变量干扰
    const baseUrl = getProviderScopedBaseUrl(claude, preset, provider, modelOverride);
    if (baseUrl) {
      env.ANTHROPIC_BASE_URL = baseUrl;
    }

    // Kimi、自定义 API_KEY 模式：用 ANTHROPIC_API_KEY；其他第三方用 AUTH_TOKEN。
    // 必须强制覆盖（不检查 process.env），并删除对立变量，
    // 因为 Claude Code SDK 用 ?? 选择 token——空字符串不会穿透。
    if (scopedKey) {
      const useApiKey = provider === 'kimi' || preset.authMethod === 'API_KEY';
      if (useApiKey) {
        env.ANTHROPIC_API_KEY = scopedKey;
        delete env.ANTHROPIC_AUTH_TOKEN;
      } else {
        env.ANTHROPIC_AUTH_TOKEN = scopedKey;
        delete env.ANTHROPIC_API_KEY;
      }
    }

    // 供应商额外环境变量（强制覆盖，避免系统 env 残留干扰）
    if (preset.extraEnv) {
      for (const [key, val] of Object.entries(preset.extraEnv)) {
        env[key] = val;
      }
    }
  }

  // 推理努力等级（per-chat override > 全局设置）
  const effort = effortOverride ?? claude.effortLevel;
  if (effort && effort !== 'high' && !process.env.CLAUDE_CODE_EFFORT_LEVEL) {
    env.CLAUDE_CODE_EFFORT_LEVEL = effort;
  }

  env.FORCE_COLOR = '0';
  // 显式移除 CLAUDECODE，防止 Claude CLI 嵌套检测误判
  delete env.CLAUDECODE;

  return env;
}

/**
 * 构造 Codex CLI exec 的环境变量。
 * Codex 使用 CODEX_API_KEY（仅 codex exec 支持）或 OAuth（~/.codex/auth.json）。
 * 调用方应确保仅在 provider=openai 时使用。
 */
export async function buildCodexExecEnv(): Promise<NodeJS.ProcessEnv> {
  const settings = await getSettings();
  const claude = settings.claude;
  const env: NodeJS.ProcessEnv = { ...process.env };
  const scopedKey = getProviderScopedApiKey(claude, 'openai');
  if (claude.authMode === 'api_key' && scopedKey && !process.env.CODEX_API_KEY) {
    env.CODEX_API_KEY = scopedKey;
  }
  env.FORCE_COLOR = '0';
  return env;
}

/**
 * 构造 --model CLI 参数。
 * 返回 ['--model', modelId] 或 []。
 */
export async function buildClaudeModelArgs(modelOverride?: string): Promise<string[]> {
  if (modelOverride) return ['--model', modelOverride];
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

// ── Agent capability → CLI args ──

/** Maps capability keys to Claude Code tool names accepted by --allowedTools */
const CAPABILITY_TOOL_MAP: Record<string, string[]> = {
  bash: ['Bash'],
  fileAccess: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit'],
  web: ['WebFetch', 'WebSearch'],
  subAgent: ['Task', 'TaskOutput', 'TaskStop'],
};

/**
 * Task 子代理如果拿不到任何读取工具，就会出现“成功发起但实际不可用”：
 * Explore / Plan 能启动，但无法搜索或读取代码。
 *
 * 因此当开启 subAgent 且未开启 fileAccess 时，自动补一组只读工具，
 * 既保留最小权限，也保证子代理至少能完成探索类任务。
 */
const SUBAGENT_READONLY_TOOLS = ['Read', 'Glob', 'Grep'];

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

  if (caps.subAgent && !caps.fileAccess) {
    allowed.push(...SUBAGENT_READONLY_TOOLS);
  }

  return ['--allowedTools', allowed.join(',')];
}

/**
 * 根据 Agent 能力配置构造权限参数。
 *
 * - Agent skipReview=false → 不传（需审核）
 * - Agent skipReview=true + 全局 skipPermissions=true → 传 --dangerously-skip-permissions
 */
export async function buildAgentPermissionArgs(
  capabilities: AgentCapabilities | undefined,
): Promise<string[]> {
  const caps = capabilities ?? DEFAULT_AGENT_CAPABILITIES;
  if (!caps.skipReview) return [];

  const settings = await getSettings();
  const skip = settings.claude.skipPermissions !== false;
  return skip ? ['--dangerously-skip-permissions'] : [];
}

// ═══════════════════════════════════════════════════════════════════════
// SDK query() option builders — Agent Chat 使用
// ═══════════════════════════════════════════════════════════════════════

import type { Options as SdkQueryOptions, PermissionMode as SdkPermissionMode } from '@anthropic-ai/claude-agent-sdk';

/**
 * 根据 Agent 能力配置构造 SDK allowedTools 列表。
 * 全部开启返回 undefined（不限制），部分开启返回工具名数组。
 */
export function buildSdkAllowedTools(capabilities: AgentCapabilities | undefined): string[] | undefined {
  const caps = capabilities ?? DEFAULT_AGENT_CAPABILITIES;
  const toolCapKeys = ['bash', 'fileAccess', 'web', 'subAgent'] as const;
  if (toolCapKeys.every(k => caps[k])) return undefined;

  const allowed: string[] = [...META_TOOLS];
  for (const key of toolCapKeys) {
    if (caps[key]) {
      allowed.push(...CAPABILITY_TOOL_MAP[key]);
    }
  }
  if (caps.subAgent && !caps.fileAccess) {
    allowed.push(...SUBAGENT_READONLY_TOOLS);
  }
  return allowed;
}

/**
 * 根据 Agent 能力配置确定 SDK permissionMode。
 */
export async function buildSdkPermissionMode(
  capabilities: AgentCapabilities | undefined,
): Promise<{ permissionMode: SdkPermissionMode; allowDangerouslySkipPermissions?: boolean }> {
  const caps = capabilities ?? DEFAULT_AGENT_CAPABILITIES;
  if (!caps.skipReview) {
    return { permissionMode: 'default' };
  }
  const settings = await getSettings();
  const skip = settings.claude.skipPermissions !== false;
  if (skip) {
    return { permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true };
  }
  return { permissionMode: 'default' };
}

/**
 * 构造 SDK query() 的 Options 对象。
 *
 * 这是 Agent Chat 的核心入口，取代了旧的 buildClaudeEnv + CLI args 组合。
 * 返回的 Options 可直接传给 query({ prompt, options })。
 */
export async function buildSdkQueryOptions(opts: {
  capabilities?: AgentCapabilities;
  providerOverride?: ProviderId;
  modelOverride?: string;
  effortOverride?: string;
  systemPrompt?: string;
  resumeSessionId?: string;
  cwd?: string;
  maxTurns?: number;
}): Promise<SdkQueryOptions> {
  const settings = await getSettings();
  const claude = settings.claude;
  const provider = opts.providerOverride ?? claude.provider ?? 'anthropic';

  // Environment variables (auth + provider routing)
  const env = await buildClaudeEnv(provider, opts.effortOverride, opts.modelOverride);

  // Model
  const model = opts.modelOverride ?? getProviderScopedModel(claude, provider);

  // Allowed tools
  const allowedTools = buildSdkAllowedTools(opts.capabilities);

  // Permission mode
  const { permissionMode, allowDangerouslySkipPermissions } = await buildSdkPermissionMode(opts.capabilities);

  // Max turns
  const maxTurns = opts.maxTurns ?? claude.maxTurns ?? undefined;

  // Effort level
  const effortValue = opts.effortOverride ?? claude.effortLevel ?? 'high';
  const effort = effortValue as SdkQueryOptions['effort'];

  const sdkOpts: SdkQueryOptions = {
    env,
    model,
    cwd: opts.cwd,
    includePartialMessages: true,
    thinking: { type: 'adaptive' },
    effort,
    permissionMode,
    ...(allowDangerouslySkipPermissions ? { allowDangerouslySkipPermissions: true } : {}),
    ...(allowedTools ? { allowedTools } : {}),
    ...(maxTurns && maxTurns > 0 ? { maxTurns } : {}),
    ...(opts.resumeSessionId ? { resume: opts.resumeSessionId } : {}),
    ...(opts.systemPrompt ? {
      systemPrompt: opts.systemPrompt,
    } : {}),
  };

  return sdkOpts;
}
