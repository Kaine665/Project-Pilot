/**
 * AI 供应商注册表 — 前后端共用。
 *
 * 每个供应商预设了 baseUrl、可选模型列表、认证方式说明。
 * 第三方供应商均使用原生 Anthropic 兼容端点，无需代理。
 */

import type { ProviderId } from '@/types';

export interface ModelOption {
  id: string;
  label: string;
}

export interface ProviderPreset {
  id: ProviderId;
  /** i18n key: settings.providers.<id> */
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
  /** API Key 占位符提示 */
  apiKeyPlaceholder?: string;
  /** 第三方供应商需要的额外环境变量 */
  extraEnv?: Record<string, string>;
  /** 是否使用 API Key（而非 OAuth）进行认证。默认 true for 第三方，false for 官方 */
  useApiKeyForAuth?: boolean;
}

export const PROVIDER_REGISTRY: ProviderPreset[] = [
  // ── Anthropic 官方 ──
  {
    id: 'anthropic',
    nameKey: 'settings.providers.anthropic',
    models: [
      { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ],
    supportsOAuth: true,
    editableBaseUrl: false,
    editableModel: true,
    apiKeyPlaceholder: 'sk-ant-api03-...',
  },

  // ── OpenAI / Codex ──
  {
    id: 'openai',
    nameKey: 'settings.providers.openai',
    models: [
      { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
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
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek V3' },
      { id: 'deepseek-reasoner', label: 'DeepSeek R1' },
    ],
    supportsOAuth: false,
    editableBaseUrl: false,
    editableModel: true,
    apiKeyPlaceholder: 'sk-...',
    extraEnv: {
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      API_TIMEOUT_MS: '600000',
    },
  },
  {
    id: 'qwen',
    nameKey: 'settings.providers.qwen',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    models: [
      { id: 'qwen3-coder-plus', label: 'Qwen3 Coder Plus' },
      { id: 'qwen3-coder', label: 'Qwen3 Coder' },
      { id: 'qwen-plus', label: 'Qwen Plus' },
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
    models: [
      { id: 'glm-4.7', label: 'GLM-4.7' },
      { id: 'glm-4.5-air', label: 'GLM-4.5 Air' },
    ],
    supportsOAuth: false,
    editableBaseUrl: false,
    editableModel: true,
    apiKeyPlaceholder: 'your-zhipu-api-key',
    extraEnv: {
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      API_TIMEOUT_MS: '3000000',
    },
  },
  {
    id: 'minimax',
    nameKey: 'settings.providers.minimax',
    baseUrl: 'https://api.minimax.chat/anthropic',
    models: [
      { id: 'MiniMax-M2.5', label: 'MiniMax M2.5' },
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
    baseUrl: 'https://api.kimi.com/coding/v1',
    models: [
      { id: 'kimi-latest', label: 'Kimi Latest' },
    ],
    supportsOAuth: false,
    editableBaseUrl: false,
    editableModel: true,
    apiKeyPlaceholder: 'your-kimi-api-key',
    extraEnv: {
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
  },

  // ── 聚合网关 ──
  {
    id: 'openrouter',
    nameKey: 'settings.providers.openrouter',
    baseUrl: 'https://openrouter.ai/api',
    models: [
      { id: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
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

/** 按 ID 查找供应商预设 */
export function getProviderPreset(id: ProviderId): ProviderPreset {
  return PROVIDER_REGISTRY.find((p) => p.id === id) ?? PROVIDER_REGISTRY[0];
}
