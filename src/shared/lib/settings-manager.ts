/**
 * SettingsManager — 全局设置读写 + Claude CLI 环境构建。
 *
 * 缓存策略：30s TTL 内存缓存，saveSettings 后立即失效。
 * 优先级：系统环境变量 > App 设置 > 默认值。
 */

import { access } from 'fs/promises';
import { resolveClaudeAgentSdkCliJsPath } from '@/lib/resolve-claude-agent-sdk-cli';
import { getDataDir, getSettingsPath, readJsonFile, writeJsonFile } from '@/lib/file-store';
import { getKimiCandidateBaseUrls, getProviderPreset } from '@/lib/provider-registry';
import type { AgentCapabilities, AppSettings, ClaudeAuthMode, ClaudeSettings, CustomProviderConfig, ProviderCredential, ProviderId, ResolvedAiCredential } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES, DEFAULT_APP_SETTINGS } from '@/types';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CACHE_TTL_MS = 30_000;

let cachedSettings: AppSettings | null = null;
let cacheTimestamp = 0;

async function resolveReadableSettingsPath(): Promise<string> {
  const primary = getSettingsPath();
  const fallbacks = [
    // 旧版曾把 settings.json 放在 DATA_DIR 根下（现为 config/settings.json）
    path.join(getDataDir(), 'settings.json'),
  ];
  for (const p of [primary, ...fallbacks]) {
    try {
      await access(p);
      return p;
    } catch {
      /* try next */
    }
  }
  return primary;
}

export async function getSettings(): Promise<AppSettings> {
  const now = Date.now();
  if (cachedSettings && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedSettings;
  }
  const p = await resolveReadableSettingsPath();
  const raw = await readJsonFile<AppSettings>(p, DEFAULT_APP_SETTINGS);
  cachedSettings = migrateCredentials(raw);
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

// ── Credential migration & unified access ──

const ANTHROPIC_CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');

/**
 * 运行时凭据迁移（幂等）。
 * 将旧的分散存储（providerApiKeys / customProviders[].apiKey / flat apiKey / 全局 authMode）
 * 合并到 providerCredentials。
 */
function migrateCredentials(settings: AppSettings): AppSettings {
  const claude = settings.claude;
  // 已有 providerCredentials → 跳过迁移
  if (claude.providerCredentials && Object.keys(claude.providerCredentials).length > 0) {
    return settings;
  }

  const creds: Partial<Record<ProviderId, ProviderCredential>> = {};

  // 1. 从 providerApiKeys 迁移
  if (claude.providerApiKeys) {
    for (const [p, key] of Object.entries(claude.providerApiKeys)) {
      if (key) {
        creds[p as ProviderId] = { authMode: 'api_key', apiKey: key };
      }
    }
  }

  // 2. 从 customProviders[].apiKey 迁移
  if (claude.customProviders) {
    for (const cp of claude.customProviders) {
      if (cp.apiKey && !creds[cp.id]) {
        creds[cp.id] = { authMode: 'api_key', apiKey: cp.apiKey };
      }
    }
  }

  // 3. 从旧 flat apiKey 迁移（仅 anthropic）
  if (claude.apiKey && !creds['anthropic']) {
    creds['anthropic'] = { authMode: 'api_key', apiKey: claude.apiKey };
  }

  // 4. Anthropic OAuth：仅当显式全局 authMode=oauth 时迁移（不再根据本机凭据文件自动推断）
  if (claude.authMode === 'oauth') {
    const existing = creds['anthropic'] ?? { authMode: 'oauth' as ClaudeAuthMode };
    existing.authMode = 'oauth';
    existing.oauth = { tokenFile: ANTHROPIC_CREDENTIALS_PATH };
    creds['anthropic'] = existing;
  }

  // 只在有数据需要迁移时才写入
  if (Object.keys(creds).length > 0) {
    claude.providerCredentials = creds;
  }

  return settings;
}

/** 统一读取凭据的返回类型 */
export interface ResolvedCredential {
  authMode: ClaudeAuthMode;
  apiKey?: string;
  /** 凭据来源（调试用） */
  source: 'providerCredentials' | 'providerApiKeys' | 'customProvider' | 'legacyApiKey' | 'default';
}

/**
 * 统一读取指定供应商的凭据。
 *
 * 优先级：
 * 1. providerCredentials[p] — 新统一存储
 * 2. providerApiKeys[p] — 旧 per-provider 存储
 * 3. customProviders[].apiKey — 自定义供应商旧存储
 * 4. claude.apiKey（仅 anthropic）— 最旧的 flat 存储
 */
export function getCredential(claude: ClaudeSettings, provider?: ProviderId): ResolvedCredential {
  const p = provider ?? claude.provider ?? 'anthropic';

  const fallbackApiKey = (): string | undefined => {
    const scoped = claude.providerApiKeys?.[p]?.trim();
    if (scoped) return scoped;
    if (p.startsWith('custom-') && claude.customProviders) {
      const cp = claude.customProviders.find((c) => c.id === p);
      const k = cp?.apiKey?.trim();
      if (k) return k;
    }
    if (p === 'anthropic' && claude.apiKey?.trim()) return claude.apiKey.trim();
    return undefined;
  };

  // 1. 新统一存储（若仅有占位、无 apiKey，须回退到旧字段，否则聚合拉模型会误判「未配置」）
  const cred = claude.providerCredentials?.[p];
  if (cred) {
    if (cred.authMode === 'oauth') {
      return {
        authMode: 'oauth',
        apiKey: cred.apiKey,
        source: 'providerCredentials',
      };
    }
    const fromCred = cred.apiKey?.trim();
    if (fromCred) {
      return {
        authMode: cred.authMode ?? 'api_key',
        apiKey: fromCred,
        source: 'providerCredentials',
      };
    }
    const fb = fallbackApiKey();
    if (fb) {
      return {
        authMode: cred.authMode ?? 'api_key',
        apiKey: fb,
        source: 'providerApiKeys',
      };
    }
    return {
      authMode: cred.authMode ?? 'api_key',
      source: 'providerCredentials',
    };
  }

  // 2. 旧 per-provider 存储
  const scopedKey = claude.providerApiKeys?.[p];
  if (scopedKey) {
    return { authMode: 'api_key', apiKey: scopedKey, source: 'providerApiKeys' };
  }

  // 3. 自定义供应商旧存储
  if (p.startsWith('custom-') && claude.customProviders) {
    const cp = claude.customProviders.find((c) => c.id === p);
    if (cp?.apiKey) {
      return { authMode: 'api_key', apiKey: cp.apiKey, source: 'customProvider' };
    }
  }

  // 4. 旧 flat apiKey（仅 anthropic）
  if (p === 'anthropic' && claude.apiKey) {
    return { authMode: claude.authMode ?? 'api_key', apiKey: claude.apiKey, source: 'legacyApiKey' };
  }

  // 无凭据：根据全局 authMode 或默认 api_key
  return { authMode: claude.authMode ?? 'api_key', source: 'default' };
}

/**
 * 解析当前供应商的凭据通道（API Key 与 OAuth 在抽象层分离）。
 * 新代码应优先用本函数分支，而不是混用 authMode + apiKey 推断。
 */
export function resolveAiCredential(claude: ClaudeSettings, provider?: ProviderId): ResolvedAiCredential {
  const p = provider ?? claude.provider ?? 'anthropic';

  if (p === 'openai' && claude.openaiOAuthEnabled === true) {
    const pc = claude.providerCredentials?.[p];
    if (pc?.authMode === 'oauth') {
      return { channel: 'oauth', oauth: 'openai_codex' };
    }
  }

  const cred = getCredential(claude, p);
  return { channel: 'api_key', apiKey: cred.apiKey };
}

/**
 * 兼容旧调用点：映射为 ClaudeAuthMode（Codex / 环境变量注入等）。
 */
export function getEffectiveAuthMode(claude: ClaudeSettings, provider?: ProviderId): ClaudeAuthMode {
  const r = resolveAiCredential(claude, provider);
  return r.channel === 'oauth' ? 'oauth' : 'api_key';
}

/**
 * 统一写入指定供应商的凭据。
 * 只写 providerCredentials[p]，不动旧字段。
 */
export async function setCredential(
  provider: ProviderId,
  credential: Partial<ProviderCredential>,
): Promise<void> {
  const settings = await getSettings();
  const claude = settings.claude;
  if (!claude.providerCredentials) claude.providerCredentials = {};

  const existing = claude.providerCredentials[provider] ?? { authMode: 'api_key' as ClaudeAuthMode };
  claude.providerCredentials[provider] = { ...existing, ...credential };

  await saveSettings(settings);
}

// ── Per-provider scoped helpers ──

/**
 * 获取指定供应商的 API Key。
 * @deprecated 内部已委托给 getCredential()，外部调用者应逐步迁移到 getCredential()。
 */
export function getProviderScopedApiKey(claude: ClaudeSettings, provider?: ProviderId): string | undefined {
  return getCredential(claude, provider).apiKey;
}

/**
 * 获取指定供应商的模型 ID。
 * 优先级：providerModels[provider] > 当前全局 provider 的旧 flat model > provider preset 第一个模型
 */
export function getProviderScopedModel(claude: ClaudeSettings, provider?: ProviderId): string {
  const p = provider ?? claude.provider ?? 'anthropic';
  const scoped = claude.providerModels?.[p]?.trim();
  if (scoped) return scoped;

  const legacy = claude.model?.trim();
  if (legacy && p === (claude.provider ?? 'anthropic')) return legacy;

  const preset = getProviderPreset(p, claude.customProviders);
  return preset.models[0]?.id ?? '';
}

/**
 * 获取指定供应商的 baseUrl。
 *
 * @param protocol 默认 `'anthropic'`（Claude Agent SDK / Anthropic Messages API）。
 *                 传 `'openai'` 时返回 OpenAI Chat Completions 协议端点
 *                 （Vercel AI SDK `generateText` 等场景）。
 *
 * anthropic 优先级：providerBaseUrls[provider] > 全局 baseUrl > preset.baseUrl
 * openai    优先级：preset.openaiBaseUrl > 去 /anthropic 后缀的 anthropic URL > preset.baseUrl
 */
export function getProviderScopedBaseUrl(
  claude: ClaudeSettings,
  preset: { baseUrl?: string; openaiBaseUrl?: string },
  provider?: ProviderId,
  modelOverride?: string,
  protocol: 'anthropic' | 'openai' = 'anthropic',
): string | undefined {
  const p = provider ?? claude.provider ?? 'anthropic';

  if (protocol === 'openai') {
    if (preset.openaiBaseUrl) return preset.openaiBaseUrl;
    const anthropicUrl = getProviderScopedBaseUrl(claude, preset, provider, modelOverride, 'anthropic');
    if (!anthropicUrl) return preset.baseUrl;
    return anthropicUrl.replace(/\/anthropic\/?$/i, '') || anthropicUrl;
  }

  const scoped = claude.providerBaseUrls?.[p];
  if (p === 'ollama') {
    const o = typeof scoped === 'string' ? scoped.trim() : '';
    return o || undefined;
  }
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
 *   - ANTHROPIC_AUTH_TOKEN: 用 apiKey 注入（Bearer；多数第三方）
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

  const cred = getCredential(claude, provider);
  const authMode = getEffectiveAuthMode(claude, provider);

  if (provider === 'anthropic' || provider === 'openai') {
    // 官方供应商（Anthropic / OpenAI）：API Key 或 OAuth
    if (authMode === 'api_key' && cred.apiKey && !process.env.ANTHROPIC_API_KEY) {
      env.ANTHROPIC_API_KEY = cred.apiKey;
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

    // Kimi、registry authMethod=API_KEY / useApiKeyForAuth：用 ANTHROPIC_API_KEY（x-api-key，含 MiniMax 国内站）；其余第三方用 AUTH_TOKEN（Bearer）。
    // 必须强制覆盖（不检查 process.env），并删除对立变量，
    // 因为 Claude Code SDK 用 ?? 选择 token——空字符串不会穿透。
    if (cred.apiKey) {
      const useApiKey = provider === 'kimi' || preset.authMethod === 'API_KEY' || !!preset.useApiKeyForAuth;
      console.log(`[buildClaudeEnv] provider=${provider} useApiKey=${useApiKey} authMethod=${preset.authMethod} useApiKeyForAuth=${preset.useApiKeyForAuth} baseUrl=${env.ANTHROPIC_BASE_URL}`);
      if (useApiKey) {
        env.ANTHROPIC_API_KEY = cred.apiKey;
        delete env.ANTHROPIC_AUTH_TOKEN;
      } else {
        env.ANTHROPIC_AUTH_TOKEN = cred.apiKey;
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
  const cred = getCredential(claude, 'openai');
  const authMode = getEffectiveAuthMode(claude, 'openai');
  if (authMode === 'api_key' && cred.apiKey) {
    if (!process.env.CODEX_API_KEY) env.CODEX_API_KEY = cred.apiKey;
    if (!process.env.OPENAI_API_KEY) env.OPENAI_API_KEY = cred.apiKey;
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
 * 根据 Agent 能力配置与全局设置确定 SDK permissionMode。
 *
 * **App 内 Agent Chat** 通过 Claude Agent SDK 拉起 Claude Code 子进程，**无 TTY、也无工具批准确认 UI**。
 * 若仍使用 `permissionMode: 'default'`，子进程会在首个工具调用前阻塞等待批准，表现为
 * **长时间「思考」、SDK 迭代 0 条消息**（常见于自定义 Agent 将 `skipReview` 设为 false，
 * 而内置 Agent 普遍为 true，故「以前用内置正常、换自定义就卡」）。
 *
 * 因此：**只要全局「跳过工具权限」开启**（设置里默认开启，`skipPermissions !== false`），
 * Agent Chat 一律使用 `bypassPermissions`，与 Agent 的 `skipReview` 无关。
 * 仅当用户在设置中**明确关闭**「跳过工具权限」时，才回落到 `default`（强约束；仍无 UI 时可能卡住）。
 */
export async function buildSdkPermissionMode(
  capabilities: AgentCapabilities | undefined,
): Promise<{ permissionMode: SdkPermissionMode; allowDangerouslySkipPermissions?: boolean }> {
  const caps = capabilities ?? DEFAULT_AGENT_CAPABILITIES;
  const settings = await getSettings();
  const globalSkip = settings.claude.skipPermissions !== false;

  if (globalSkip) {
    return { permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true };
  }

  if (!caps.skipReview) {
    console.warn(
      '[buildSdkPermissionMode] 全局已关闭「跳过工具权限」且 Agent skipReview=false；'
      + ' Claude Code 可能等待交互批准确认，App 内若无对应界面会无输出。',
    );
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
  /** 最大预算（美元），超限返回 error_max_budget_usd */
  maxBudgetUsd?: number;
  /** SDK hooks 配置，支持 PreToolUse、PostToolUse 等事件干预 */
  hooks?: SdkQueryOptions['hooks'];
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

  // `thinking` 仅官方 Anthropic 支持；第三方兼容端（DeepSeek/Qwen 等）不识别此参数，
  // 会导致 SDK 请求被拒或静默挂住。
  const supportsThinking = provider === 'anthropic';

  const debugSdk = process.env.DEBUG_CLAUDE_AGENT_SDK === '1' || provider !== 'anthropic';

  // Bun + Claude Agent SDK 的 CLI 子进程不兼容（Bun spawn bun cli.js 后 0 条事件）。
  // 强制使用 node 作为子进程可执行文件。
  const executable = 'node';

  const sdkOpts: SdkQueryOptions = {
    env: { ...env, ...(debugSdk ? { DEBUG_CLAUDE_AGENT_SDK: '1' } : {}) },
    model,
    cwd: opts.cwd,
    pathToClaudeCodeExecutable: resolveClaudeAgentSdkCliJsPath(),
    executable,
    includePartialMessages: true,
    ...(supportsThinking ? { thinking: { type: 'adaptive' } } : {}),
    effort,
    permissionMode,
    ...(allowDangerouslySkipPermissions ? { allowDangerouslySkipPermissions: true } : {}),
    ...(allowedTools ? { allowedTools } : {}),
    ...(maxTurns && maxTurns > 0 ? { maxTurns } : {}),
    ...(opts.maxBudgetUsd && opts.maxBudgetUsd > 0 ? { maxBudgetUsd: opts.maxBudgetUsd } : {}),
    ...(opts.hooks ? { hooks: opts.hooks } : {}),
    ...(opts.resumeSessionId ? { resume: opts.resumeSessionId } : {}),
    ...(opts.systemPrompt ? {
      systemPrompt: opts.systemPrompt,
    } : {}),
    stderr: debugSdk ? (data: string) => {
      for (const line of data.split('\n')) {
        if (line.trim()) console.log(`[ClaudeRunner:stderr] ${line}`);
      }
    } : undefined,
  } as SdkQueryOptions;

  return sdkOpts;
}
