/**
 * AI 供应商注册表 — 前后端共用。
 *
 * 每个供应商预设了 baseUrl、可选模型列表、认证方式说明。
 * 第三方供应商均使用原生 Anthropic 兼容端点，无需代理。
 * 自定义供应商通过 customProviders 传入，转为 ProviderPreset。
 */

import type { ProviderId, CustomProviderConfig } from '@/types';

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
  /** 固定 baseUrl，undefined 表示不需要（如 Anthropic 官方用默认） */
  baseUrl?: string;
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
}

export const PROVIDER_REGISTRY: ProviderPreset[] = [
  // ── Anthropic 官方 ──
  {
    id: 'anthropic',
    nameKey: 'settings.providers.anthropic',
    models: [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ],
    supportsOAuth: true,
    editableBaseUrl: false,
    editableModel: true,
    apiKeyPlaceholder: 'sk-ant-api03-...',
    useApiKeyForAuth: true,
  },

  // ── OpenAI / Codex ──
  {
    id: 'openai',
    nameKey: 'settings.providers.openai',
    models: [
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
      { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
      { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
      { id: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
      { id: 'gpt-5.2', label: 'GPT-5.2' },
      { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini' },
    ],
    supportsOAuth: true,
    editableBaseUrl: false,
    editableModel: true,
    apiKeyPlaceholder: 'sk-...',
  },

  // ── 中国厂商（原生 Anthropic 兼容端点） ──
  {
    id: 'deepseek',
    nameKey: 'settings.providers.deepseek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    candidateBaseUrls: ['https://api.deepseek.com/anthropic'],
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek V3' },
      { id: 'deepseek-reasoner', label: 'DeepSeek R1' },
    ],
    supportsOAuth: false,
    editableBaseUrl: false,
    editableModel: true,
    apiKeyPlaceholder: 'sk-...',
    useApiKeyForAuth: true,
    extraEnv: {
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      API_TIMEOUT_MS: '600000',
    },
  },
  {
    id: 'qwen',
    nameKey: 'settings.providers.qwen',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    candidateBaseUrls: [
      'https://coding.dashscope.aliyuncs.com/apps/anthropic',
      'https://dashscope-intl.aliyuncs.com/apps/anthropic',
      'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic',
    ],
    models: [
      { id: 'qwen3-coder-plus', label: 'Qwen3 Coder Plus' },
      { id: 'qwen3-coder-flash', label: 'Qwen3 Coder Flash' },
      { id: 'qwen3-coder', label: 'Qwen3 Coder' },
    ],
    supportsOAuth: false,
    editableBaseUrl: true,
    editableModel: true,
    apiKeyPlaceholder: 'sk-...',
    extraEnv: {
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
  },
  {
    id: 'zhipu',
    nameKey: 'settings.providers.zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    candidateBaseUrls: ['https://open.bigmodel.cn/api/anthropic'],
    models: [
      { id: 'glm-4.7', label: 'GLM-4.7' },
      { id: 'glm-4.7-flashx', label: 'GLM-4.7 FlashX' },
      { id: 'glm-4.5', label: 'GLM-4.5' },
      { id: 'glm-4.5-air', label: 'GLM-4.5 Air' },
    ],
    supportsOAuth: false,
    editableBaseUrl: false,
    editableModel: true,
    apiKeyPlaceholder: 'your-zhipu-api-key',
    useApiKeyForAuth: true,
    extraEnv: {
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      API_TIMEOUT_MS: '3000000',
    },
  },
  {
    id: 'minimax',
    nameKey: 'settings.providers.minimax',
    baseUrl: 'https://api.minimax.chat/anthropic',
    candidateBaseUrls: [
      'https://api.minimax.chat/anthropic',
      'https://api.minimax.io/anthropic',
      'https://api.minimaxi.com/anthropic',
    ],
    models: [
      { id: 'MiniMax-M2.5', label: 'MiniMax M2.5' },
      { id: 'MiniMax-M2.5-highspeed', label: 'MiniMax M2.5 Highspeed' },
      { id: 'MiniMax-M2.1', label: 'MiniMax M2.1' },
      { id: 'MiniMax-M2', label: 'MiniMax M2' },
    ],
    supportsOAuth: false,
    editableBaseUrl: true,
    editableModel: true,
    apiKeyPlaceholder: 'your-minimax-api-key',
    extraEnv: {
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
  },

  {
    id: 'kimi',
    nameKey: 'settings.providers.kimi',
    // Claude Code 要求 base 不带 /v1，SDK 会拼接 /v1/messages
    baseUrl: 'https://api.kimi.com/coding/',
    candidateBaseUrls: [
      'https://api.kimi.com/coding/',
      'https://api.moonshot.ai/anthropic',
      'https://api.moonshot.cn/anthropic',
    ],
    models: [
      // Kimi Code (api.kimi.com) 模型，官方文档唯一正确 ID
      { id: 'kimi-for-coding', label: 'Kimi For Coding (K2.5)' },
      { id: 'k2p5', label: 'Kimi K2.5 (Code)' },
      // Moonshot (api.moonshot.ai) 模型
      { id: 'kimi-k2.5', label: 'Kimi K2.5 (Moonshot)' },
      { id: 'kimi-k2', label: 'Kimi K2' },
      { id: 'kimi-k2-thinking', label: 'Kimi K2 Thinking' },
    ],
    supportsOAuth: false,
    editableBaseUrl: false,
    editableModel: true,
    apiKeyPlaceholder: 'sk-kimi-...',
    extraEnv: {
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      ENABLE_TOOL_SEARCH: 'FALSE',
    },
  },

  // ── 聚合网关 ──
  {
    id: 'openrouter',
    nameKey: 'settings.providers.openrouter',
    baseUrl: 'https://openrouter.ai/api',
    candidateBaseUrls: ['https://openrouter.ai/api'],
    models: [
      { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'anthropic/claude-opus-4-6', label: 'Claude Opus 4.6' },
      { id: 'openai/gpt-4o', label: 'GPT-4o' },
      { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'deepseek/deepseek-chat', label: 'DeepSeek V3' },
    ],
    supportsOAuth: false,
    editableBaseUrl: false,
    editableModel: true,
    apiKeyPlaceholder: 'sk-or-v1-...',
    extraEnv: {
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
  },

  // ── 本地模型 ──
  {
    id: 'ollama',
    nameKey: 'settings.providers.ollama',
    baseUrl: 'http://localhost:11434',
    models: [
      { id: 'qwen3-coder', label: 'Qwen3 Coder' },
      { id: 'deepseek-coder-v2', label: 'DeepSeek Coder V2' },
    ],
    supportsOAuth: false,
    editableBaseUrl: true,
    editableModel: true,
    extraEnv: {
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
  },

  // ── 自定义 ──
  {
    id: 'custom',
    nameKey: 'settings.providers.custom',
    models: [],
    supportsOAuth: false,
    editableBaseUrl: true,
    editableModel: true,
    apiKeyPlaceholder: 'your-api-key',
    extraEnv: {
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
  },
];

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

/**
 * 常用模型的上下文窗口大小（token 数）。
 * 不在此表中的模型走 pattern-based fallback。
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // ── Anthropic Claude ──
  'claude-opus-4-6': 200000,
  'claude-sonnet-4-6': 200000,
  'claude-haiku-4-5-20251001': 200000,
  'claude-haiku-4-5-20250929': 200000,
  'claude-sonnet-4-5-20250929': 200000,
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-5-haiku-20241022': 200000,
  'claude-3-opus-20240229': 200000,
  // ── DeepSeek ──
  'deepseek-chat': 65536,
  'deepseek-reasoner': 65536,
  // ── Qwen ──
  'qwen3-coder-plus': 131072,
  'qwen3-coder-flash': 131072,
  'qwen3-coder': 131072,
  // ── Zhipu GLM ──
  'glm-4.7': 128000,
  'glm-4.7-flashx': 128000,
  'glm-4.5': 128000,
  'glm-4.5-air': 128000,
  // ── MiniMax ──
  'MiniMax-M2.5': 1000000,
  'MiniMax-M2.5-highspeed': 1000000,
  'MiniMax-M2.1': 1000000,
  'MiniMax-M2': 1000000,
  // ── Kimi / Moonshot ──
  'kimi-for-coding': 131072,
  'k2p5': 131072,
  'kimi-k2.5': 131072,
  'kimi-k2': 131072,
  'kimi-k2-thinking': 131072,
};

/**
 * 根据模型 ID 查询上下文窗口大小（token 数）。
 * 优先精确匹配，其次按供应商前缀推断，最后返回通用默认值。
 */
export function getModelContextWindow(modelId: string): number {
  // 精确匹配
  if (MODEL_CONTEXT_WINDOWS[modelId]) return MODEL_CONTEXT_WINDOWS[modelId];
  // 前缀推断
  if (modelId.startsWith('claude-')) return 200000;
  if (modelId.startsWith('gpt-')) return 128000;
  if (modelId.startsWith('o1') || modelId.startsWith('o3')) return 200000;
  if (modelId.startsWith('deepseek-')) return 65536;
  if (modelId.startsWith('qwen')) return 131072;
  if (modelId.startsWith('glm-')) return 128000;
  if (modelId.startsWith('kimi-') || modelId.startsWith('moonshot-')) return 131072;
  if (modelId.startsWith('MiniMax-')) return 1000000;
  if (modelId.includes('gemini-2.5')) return 1000000;
  if (modelId.includes('gemini-')) return 128000;
  // OpenRouter 格式 "provider/model"
  if (modelId.includes('/claude-')) return 200000;
  if (modelId.includes('/gpt-')) return 128000;
  if (modelId.includes('/gemini-2.5')) return 1000000;
  // 通用默认值
  return 128000;
}
