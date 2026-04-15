/**
 * AI 供应商注册表 — 前后端共用。
 *
 * 数据源：src/data/providers-registry.json（纯数据，改配置不碰代码）
 * 校验：启动时用 Zod schema 校验，不合规直接报错，防止配置被无意改坏。
 *
 * 每个供应商预设了 baseUrl、可选模型列表、认证方式说明。
 * 第三方供应商均使用原生 Anthropic 兼容端点，无需代理。
 * 自定义供应商通过 customProviders 传入，转为 ProviderPreset。
 */

import { z } from 'zod';
import type { ProviderId, CustomProviderConfig } from '@/types';
import registryJson from '@/data/providers-registry.json';

// ─── Zod Schemas ───────────────────────────────────────────────

const ModelOptionSchema = z.object({
  id: z.string().min(1, 'Model id must not be empty'),
  label: z.string().min(1, 'Model label must not be empty'),
  contextWindow: z.number().int().positive().optional(),
});

const ProviderEntrySchema = z.object({
  id: z.string().min(1),
  nameKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
  openaiBaseUrl: z.string().url().optional(),
  candidateBaseUrls: z.array(z.string().url()).optional(),
  models: z.array(ModelOptionSchema),
  supportsOAuth: z.boolean(),
  editableBaseUrl: z.boolean(),
  editableModel: z.boolean(),
  apiKeyPlaceholder: z.string().optional(),
  useApiKeyForAuth: z.boolean().optional(),
  apiProtocol: z.enum(['anthropic', 'openai']).optional(),
  authMethod: z.enum(['AUTH_TOKEN', 'API_KEY']).optional(),
  extraEnv: z.record(z.string(), z.string()).optional(),
  /** 与聊天 base 不同的模型列表根地址（Zod 须显式声明，否则 parse 会剥掉未知键） */
  modelsListBaseUrl: z.string().url().optional(),
  modelsListProtocol: z.enum(['anthropic', 'openai']).optional(),
  modelsListRelativePath: z.string().min(1).optional(),
  /** 设置页「申请 API / 文档与计费」外链；OAuth 或纯本地供应商不写 */
  apiPortalUrl: z.string().url().optional(),
});

const FallbackRuleSchema = z.object({
  pattern: z.string().min(1),
  contextWindow: z.number().int().positive(),
});

const RegistrySchema = z.object({
  providers: z.array(ProviderEntrySchema).min(1, 'At least one provider required'),
  contextWindowFallbacks: z.object({
    rules: z.array(FallbackRuleSchema),
    containsRules: z.array(FallbackRuleSchema),
    default: z.number().int().positive(),
  }),
  extraContextWindows: z.record(z.string(), z.number().int().positive()),
  kimiRouting: z.object({
    codeBaseUrl: z.string().url(),
    moonshotBaseUrls: z.array(z.string().url()).min(1),
    codeModelIds: z.array(z.string().min(1)).min(1),
    moonshotModelIds: z.array(z.string().min(1)).min(1),
  }),
});

/** Re-export schema for external validation / testing */
export { RegistrySchema as ProvidersRegistrySchema };

// ─── 启动时校验 ────────────────────────────────────────────────

// 过滤掉 JSON 中的 _comment 字段后校验
function stripComments<T>(obj: T): T {
  if (Array.isArray(obj)) return obj.map(stripComments) as T;
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k === '_comment') continue;
      result[k] = stripComments(v);
    }
    return result as T;
  }
  return obj;
}

const parsed = RegistrySchema.safeParse(stripComments(registryJson));
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i: z.core.$ZodIssue) => `  - [${i.path.join('.')}] ${i.message}`)
    .join('\n');
  throw new Error(
    `[provider-registry] providers-registry.json schema validation failed:\n${issues}`,
  );
}

const REGISTRY_DATA = parsed.data;

// ─── 导出类型（保持与原有接口完全兼容） ──────────────────────────

export interface ModelOption {
  id: string;
  label: string;
  /** 模型上下文窗口大小（token 数） */
  contextWindow?: number;
}

export interface ProviderPreset {
  id: ProviderId;
  /** i18n key 或显示名称（自定义供应商用 name） */
  nameKey: string;
  /** 固定 baseUrl（Anthropic Messages 协议），undefined 表示不需要（如 Anthropic 官方用默认） */
  baseUrl?: string;
  /** OpenAI Chat Completions 协议端点（Vercel AI SDK generateText 等场景） */
  openaiBaseUrl?: string;
  /** 推荐模型列表（第一个为默认值） */
  models: ModelOption[];
  /** 是否支持 OAuth 登录（Anthropic / OpenAI） */
  supportsOAuth: boolean;
  /** 是否需要用户自填 baseUrl（custom / ollama） */
  editableBaseUrl: boolean;
  /** 是否允许用户自填模型 ID */
  editableModel: boolean;
  /** 多 URL 候选（如 Kimi 双接入方式），测试连接时依次尝试，成功后持久化 */
  candidateBaseUrls?: string[];
  /** API Key 占位符提示 */
  apiKeyPlaceholder?: string;
  /** 第三方供应商需要的额外环境变量 */
  extraEnv?: Record<string, string>;
  /** 是否使用 API Key（而非 OAuth）进行认证。默认 true for 第三方，false for 官方 */
  useApiKeyForAuth?: boolean;
  /** 自定义供应商：API 协议（anthropic 兼容时走 ANTHROPIC_BASE_URL） */
  apiProtocol?: 'anthropic' | 'openai';
  /** 自定义供应商：认证方式 */
  authMethod?: 'AUTH_TOKEN' | 'API_KEY';
  /** 模型列表接口根地址（不同于聊天 baseUrl 时使用，如 DeepSeek） */
  modelsListBaseUrl?: string;
  /** 模型列表接口协议（默认与聊天一致；有些供应商聊天走 Anthropic、列表走 OpenAI） */
  modelsListProtocol?: 'anthropic' | 'openai';
  /** OpenAI 式列表在 origin 下的路径段（默认 v1/models；DeepSeek 官方为 models） */
  modelsListRelativePath?: string;
  /** 官方 API 文档或控制台（密钥/计费）；仅 API Key 类供应商配置 */
  apiPortalUrl?: string;
}

// ─── 从 JSON 数据构建 PROVIDER_REGISTRY ─────────────────────────

export const PROVIDER_REGISTRY: ProviderPreset[] = REGISTRY_DATA.providers.map((p) => ({
  ...p,
  id: p.id as ProviderId,
}));

// ─── 上下文窗口查找表（从 JSON model.contextWindow + extraContextWindows 构建）

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {};

// 从每个供应商的 models 中收集 contextWindow
for (const provider of REGISTRY_DATA.providers) {
  for (const model of provider.models) {
    if (model.contextWindow) {
      MODEL_CONTEXT_WINDOWS[model.id] = model.contextWindow;
    }
  }
}

// 合并 extraContextWindows（旧版/别名模型 ID）
Object.assign(MODEL_CONTEXT_WINDOWS, REGISTRY_DATA.extraContextWindows);

// ─── Kimi 路由（从 JSON kimiRouting 构建） ──────────────────────

const KIMI_CODE_BASE_URL = REGISTRY_DATA.kimiRouting.codeBaseUrl;
const KIMI_MOONSHOT_BASE_URLS = REGISTRY_DATA.kimiRouting.moonshotBaseUrls;
const KIMI_CODE_MODEL_IDS = new Set(REGISTRY_DATA.kimiRouting.codeModelIds);
const KIMI_MOONSHOT_MODEL_IDS = new Set(REGISTRY_DATA.kimiRouting.moonshotModelIds);

// ─── 公共 API（签名与原有完全一致） ─────────────────────────────

/** 按 ID 查找供应商预设，支持自定义供应商 */
export function getProviderPreset(id: ProviderId, customProviders?: CustomProviderConfig[]): ProviderPreset {
  if (id.startsWith('custom-') && customProviders) {
    const cp = customProviders.find((c) => c.id === id);
    if (cp) {
      return {
        id: cp.id,
        nameKey: cp.name,
        baseUrl: cp.baseUrl,
        models: cp.modelIds.map((mid) => ({ id: mid, label: mid })),
        supportsOAuth: false,
        editableBaseUrl: false,
        editableModel: true,
        apiKeyPlaceholder: cp.authMethod === 'API_KEY' ? 'sk-...' : 'token...',
        useApiKeyForAuth: true,
        apiProtocol: cp.apiProtocol,
        authMethod: cp.authMethod,
        extraEnv: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
      };
    }
  }
  return PROVIDER_REGISTRY.find((p) => p.id === id) ?? PROVIDER_REGISTRY[0];
}

export function getKimiModelChannel(modelId: string): 'code' | 'moonshot' | 'unknown' {
  const id = modelId.trim().toLowerCase();
  if (!id) return 'unknown';
  if (KIMI_CODE_MODEL_IDS.has(id)) return 'code';
  if (KIMI_MOONSHOT_MODEL_IDS.has(id)) return 'moonshot';
  return 'unknown';
}

export function getKimiCandidateBaseUrls(modelId: string, preferredBaseUrl?: string): string[] {
  const channel = getKimiModelChannel(modelId);
  const ordered: string[] = [];
  const add = (url?: string) => {
    const value = (url || '').trim();
    if (value && !ordered.includes(value)) ordered.push(value);
  };

  if (channel === 'code') {
    add(KIMI_CODE_BASE_URL);
    return ordered;
  }

  if (channel === 'moonshot') {
    if (preferredBaseUrl && preferredBaseUrl.includes('api.moonshot')) {
      add(preferredBaseUrl);
    }
    for (const url of KIMI_MOONSHOT_BASE_URLS) add(url);
    return ordered;
  }

  // 未知模型：保守提供全部候选，优先保留用户/历史选择
  add(preferredBaseUrl);
  add(KIMI_CODE_BASE_URL);
  for (const url of KIMI_MOONSHOT_BASE_URLS) add(url);
  return ordered;
}

/**
 * 根据模型 ID 查询上下文窗口大小（token 数）。
 * 优先精确匹配，其次按供应商前缀推断，最后返回通用默认值。
 */
export function getModelContextWindow(modelId: string): number {
  // 精确匹配
  if (MODEL_CONTEXT_WINDOWS[modelId]) return MODEL_CONTEXT_WINDOWS[modelId];

  const { rules, containsRules } = REGISTRY_DATA.contextWindowFallbacks;

  // 前缀推断
  for (const rule of rules) {
    if (modelId.startsWith(rule.pattern)) return rule.contextWindow;
  }

  // 包含推断（OpenRouter 格式 "provider/model" 等）
  for (const rule of containsRules) {
    if (modelId.includes(rule.pattern)) return rule.contextWindow;
  }

  // 通用默认值
  return REGISTRY_DATA.contextWindowFallbacks.default;
}
