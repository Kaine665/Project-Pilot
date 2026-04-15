import { Hono } from 'hono';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { getSettings, saveSettings, getCredential, getEffectiveAuthMode, setCredential, getProviderScopedApiKey, getProviderScopedModel } from '@/lib/settings-manager';
import {
  isValidBuiltInSoundId,
  isValidSoundSource,
  MAX_CUSTOM_SOUND_DATA_URL_LENGTH,
  normalizeNotificationSettings,
} from '@/lib/notification/notification-sound-presets';
import { normalizeOpenAIFastMode } from '@/lib/openai-fast-mode';
import { OPENAI_REASONING_EFFORTS } from '@/lib/openai-reasoning-effort';
import { checkClaudeCliHealth, execClaude, resolveClaudeCliInvocation } from '@/lib/claude-cli';
import { checkAuthFromCredentials, extractAuthCode, exchangeCodeForTokens, saveTokens } from '@/lib/oauth-flow';
import { parseAuthState, parseAuthStatusText, type AuthState } from '@/lib/oauth-status';
import {
  getPkceSession,
  setPkceSession,
  getLoginProvider,
  setLoginProvider,
  getLoginProcess,
  setLoginProcess,
  getCapturedLoginUrl,
  setCapturedLoginUrl,
  getCapturedLoginCode,
  setCapturedLoginCode,
} from '@/lib/auth-login-state';
import {
  getDataDir,
  getProjectsPath,
  getProjectsIndexPath,
  getAgentsPath,
  getAgentChatSessionsPath,
  getAgentChatMessagesDir,
  getLegacyBoardDataDir,
  getLegacyBoardPreviousDir,
  removeLegacyBoardDataDirs,
  getPromptsDir,
  writeJsonFile,
  readJsonFile,
  readProjectIndex,
  writeProjectIndex,
} from '@/lib/file-store';
import { importSessionsWithMessages, readMessages, listAllSessions, deleteAllMessageFiles } from '@/lib/chat-managers/agent-chat-session-store';
import { getDefaultAgents } from '@/lib/default-agents';
import { writePromptFile, resolveSystemPrompt } from '@/lib/agent-prompt-store';
import { invalidateAgentsCache } from '@/lib/agents-store';
import { documentTextWriteErrorResponse } from '@/lib/document-text-write-guard';
import { listOpenAIModels } from '@/lib/codex-model-catalog';
import { getAggregateLiveModels, probeSupplierLive, type AggregateLiveModelsResult } from '@/lib/aggregate-models-live';
import { getKimiCandidateBaseUrls, getProviderPreset } from '@/lib/provider-registry';
import { testTitleChainEntry } from '@/lib/session-title-generator';
import { runHealthCheck, readHealthResults } from '@/lib/model-health-check';
import type {
  ClaudeAuthMode,
  ProviderId,
  EffortLevel,
  OpenAIReasoningEffort,
  AppSettings,
  DangerCategory,
  DangerActionLevel,
  CustomProviderConfig,
  NotificationClickAction,
  Agent,
  AgentsData,
  TitleGenerationChainEntry,
  ProjectConfig,
  ProjectEntry,
} from '@/types';
import type { AgentChatSession, AgentChatSessionsData } from '@/types/agent-chat';
import { DEFAULT_DANGER_SETTINGS, DEFAULT_DEVELOPER_SETTINGS, DEFAULT_NOTIFICATION_SETTINGS, BUILT_IN_PROVIDER_IDS } from '@/types';

const app = new Hono();

// ─── Shared validation helpers ──────────────────────────────────

const VALID_AUTH_MODES: ClaudeAuthMode[] = ['api_key', 'oauth'];
const VALID_EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high'];
const VALID_OPENAI_EFFORTS: OpenAIReasoningEffort[] = [...OPENAI_REASONING_EFFORTS];
const VALID_NOTIFICATION_CLICK_ACTIONS: NotificationClickAction[] = ['open_session', 'focus_app', 'none'];
const VALID_DANGER_LEVELS: DangerActionLevel[] = ['critical', 'warning', 'disabled'];
const VALID_DANGER_CATEGORIES: DangerCategory[] = [
  'dataDirectory', 'sqlDestructive', 'diskFormat',
  'fileDestructive', 'gitDangerous', 'npmPublish', 'processKill',
];

function isValidProvider(id: string, customProviders?: CustomProviderConfig[]): id is ProviderId {
  if (BUILT_IN_PROVIDER_IDS.includes(id as (typeof BUILT_IN_PROVIDER_IDS)[number])) return true;
  if (id.startsWith('custom-') && customProviders?.some((cp) => cp.id === id)) return true;
  return false;
}

// ─── GET / — settings (masked API keys) ─────────────────────────

app.get('/', async (c) => {
  const settings = await getSettings();

  const maskKey = (key: string) => key.length > 4 ? '••••••••' + key.slice(-4) : '••••';

  const masked: AppSettings = {
    ...settings,
    claude: { ...settings.claude },
  };
  if (masked.claude.apiKey) {
    masked.claude.apiKey = maskKey(masked.claude.apiKey);
  }
  if (masked.claude.providerApiKeys) {
    const maskedKeys: Partial<Record<ProviderId, string>> = {};
    for (const [pid, key] of Object.entries(masked.claude.providerApiKeys)) {
      if (key) maskedKeys[pid as ProviderId] = maskKey(key);
    }
    masked.claude.providerApiKeys = maskedKeys;
  }
  if (masked.claude.providerCredentials) {
    const maskedCreds: typeof masked.claude.providerCredentials = {};
    for (const [pid, cred] of Object.entries(masked.claude.providerCredentials)) {
      if (cred) {
        maskedCreds[pid as ProviderId] = cred.apiKey
          ? { ...cred, apiKey: maskKey(cred.apiKey) }
          : { ...cred };
      }
    }
    masked.claude.providerCredentials = maskedCreds;
  }
  if (masked.claude.customProviders) {
    masked.claude.customProviders = masked.claude.customProviders.map((cp) =>
      cp.apiKey ? { ...cp, apiKey: maskKey(cp.apiKey) } : cp,
    );
  }

  return c.json(masked);
});

// ─── POST / — save settings ─────────────────────────────────────

app.post('/', async (c) => {
  const body = await c.req.json();
  const current = await getSettings();

  if (body.claude?.authMode !== undefined && !VALID_AUTH_MODES.includes(body.claude.authMode)) {
    return c.json({ error: 'Invalid authMode' }, 400);
  }
  if (body.claude?.provider !== undefined && !isValidProvider(body.claude.provider, current.claude.customProviders)) {
    return c.json({ error: 'Invalid provider' }, 400);
  }
  if (body.claude?.model !== undefined) {
    if (typeof body.claude.model !== 'string' || body.claude.model.length > 200) {
      return c.json({ error: 'Invalid model' }, 400);
    }
  }
  if (body.claude?.apiKey !== undefined && typeof body.claude.apiKey !== 'string') {
    return c.json({ error: 'apiKey must be a string' }, 400);
  }
  if (body.claude?.apiKey?.length > 500) {
    return c.json({ error: 'apiKey too long' }, 400);
  }
  if (body.claude?.baseUrl !== undefined && typeof body.claude.baseUrl !== 'string') {
    return c.json({ error: 'baseUrl must be a string' }, 400);
  }
  if (body.claude?.effortLevel !== undefined && !VALID_EFFORT_LEVELS.includes(body.claude.effortLevel)) {
    return c.json({ error: 'Invalid effortLevel' }, 400);
  }
  if (body.claude?.maxTurns !== undefined) {
    const mt = Number(body.claude.maxTurns);
    if (!Number.isFinite(mt) || mt < 0 || mt > 1000) {
      return c.json({ error: 'maxTurns must be 0-1000' }, 400);
    }
  }
  if (body.claude?.openaiReasoningEffort !== undefined
    && !VALID_OPENAI_EFFORTS.includes(body.claude.openaiReasoningEffort)) {
    return c.json({ error: 'Invalid openaiReasoningEffort' }, 400);
  }
  if (body.claude?.openaiFastMode !== undefined && normalizeOpenAIFastMode(body.claude.openaiFastMode) === undefined) {
    return c.json({ error: 'Invalid openaiFastMode' }, 400);
  }
  if (body.claude?.openaiOAuthEnabled !== undefined && typeof body.claude.openaiOAuthEnabled !== 'boolean') {
    return c.json({ error: 'openaiOAuthEnabled must be a boolean' }, 400);
  }
  if (body.claude?.providerApiKeys !== undefined) {
    if (typeof body.claude.providerApiKeys !== 'object' || body.claude.providerApiKeys === null) {
      return c.json({ error: 'providerApiKeys must be an object' }, 400);
    }
    for (const [pid, val] of Object.entries(body.claude.providerApiKeys)) {
      if (!isValidProvider(pid, current.claude.customProviders)) {
        return c.json({ error: `Invalid provider in providerApiKeys: ${pid}` }, 400);
      }
      if (val !== null && val !== '' && typeof val !== 'string') {
        return c.json({ error: 'providerApiKeys values must be strings' }, 400);
      }
    }
  }
  if (body.claude?.providerModels !== undefined) {
    if (typeof body.claude.providerModels !== 'object' || body.claude.providerModels === null) {
      return c.json({ error: 'providerModels must be an object' }, 400);
    }
  }
  if (body.claude?.providerModelLibrary !== undefined) {
    if (typeof body.claude.providerModelLibrary !== 'object' || body.claude.providerModelLibrary === null) {
      return c.json({ error: 'providerModelLibrary must be an object' }, 400);
    }
    for (const arr of Object.values(body.claude.providerModelLibrary)) {
      if (!Array.isArray(arr) || (arr as unknown[]).length > 200) {
        return c.json({ error: 'providerModelLibrary values must be arrays (max 200)' }, 400);
      }
    }
  }
  if (body.claude?.providerBaseUrls !== undefined) {
    if (typeof body.claude.providerBaseUrls !== 'object' || body.claude.providerBaseUrls === null) {
      return c.json({ error: 'providerBaseUrls must be an object' }, 400);
    }
    for (const [pid, val] of Object.entries(body.claude.providerBaseUrls)) {
      if (!isValidProvider(pid, current.claude.customProviders)) {
        return c.json({ error: `Invalid provider in providerBaseUrls: ${pid}` }, 400);
      }
      if (val !== null && val !== '' && typeof val !== 'string') {
        return c.json({ error: 'providerBaseUrls values must be strings' }, 400);
      }
      if (typeof val === 'string' && val.length > 500) {
        return c.json({ error: 'providerBaseUrls value too long' }, 400);
      }
    }
  }
  if (body.general?.telemetry !== undefined && typeof body.general.telemetry !== 'boolean') {
    return c.json({ error: 'telemetry must be a boolean' }, 400);
  }
  if (body.developer !== undefined) {
    if (typeof body.developer !== 'object' || body.developer === null) {
      return c.json({ error: 'developer must be an object' }, 400);
    }
    if (body.developer.schedulesPageEnabled !== undefined && typeof body.developer.schedulesPageEnabled !== 'boolean') {
      return c.json({ error: 'developer.schedulesPageEnabled must be a boolean' }, 400);
    }
    if (body.developer.taskTriggersPageEnabled !== undefined && typeof body.developer.taskTriggersPageEnabled !== 'boolean') {
      return c.json({ error: 'developer.taskTriggersPageEnabled must be a boolean' }, 400);
    }
  }
  if (body.dangerDetector !== undefined) {
    if (typeof body.dangerDetector !== 'object' || body.dangerDetector === null) {
      return c.json({ error: 'dangerDetector must be an object' }, 400);
    }
    for (const [cat, level] of Object.entries(body.dangerDetector)) {
      if (!VALID_DANGER_CATEGORIES.includes(cat as DangerCategory)) {
        return c.json({ error: `Invalid danger category: ${cat}` }, 400);
      }
      if (!VALID_DANGER_LEVELS.includes(level as DangerActionLevel)) {
        return c.json({ error: `Invalid danger level for ${cat}: ${level}` }, 400);
      }
    }
  }
  if (body.claude?.customProviders !== undefined) {
    if (!Array.isArray(body.claude.customProviders)) {
      return c.json({ error: 'customProviders must be an array' }, 400);
    }
    if (body.claude.customProviders.length > 50) {
      return c.json({ error: 'customProviders max 50' }, 400);
    }
    const seen = new Set<string>();
    for (const cp of body.claude.customProviders as CustomProviderConfig[]) {
      if (!cp || typeof cp !== 'object') {
        return c.json({ error: 'Each customProvider must be an object' }, 400);
      }
      if (!cp.id || !cp.id.startsWith('custom-')) {
        return c.json({ error: 'customProvider.id must start with custom-' }, 400);
      }
      if (seen.has(cp.id)) {
        return c.json({ error: `Duplicate customProvider id: ${cp.id}` }, 400);
      }
      seen.add(cp.id);
      if (!cp.name || typeof cp.name !== 'string' || cp.name.length > 100) {
        return c.json({ error: 'customProvider.name required, max 100 chars' }, 400);
      }
      if (!['anthropic', 'openai'].includes(cp.apiProtocol)) {
        return c.json({ error: 'customProvider.apiProtocol must be anthropic or openai' }, 400);
      }
      if (!cp.baseUrl || typeof cp.baseUrl !== 'string' || cp.baseUrl.length > 500) {
        return c.json({ error: 'customProvider.baseUrl required, max 500 chars' }, 400);
      }
      if (!['AUTH_TOKEN', 'API_KEY'].includes(cp.authMethod)) {
        return c.json({ error: 'customProvider.authMethod must be AUTH_TOKEN or API_KEY' }, 400);
      }
      if (!Array.isArray(cp.modelIds) || cp.modelIds.length === 0 || cp.modelIds.length > 50) {
        return c.json({ error: 'customProvider.modelIds must be non-empty array, max 50' }, 400);
      }
      for (const mid of cp.modelIds) {
        if (typeof mid !== 'string' || mid.length > 200) {
          return c.json({ error: 'customProvider.modelIds entries must be strings, max 200' }, 400);
        }
      }
    }
  }
  if (body.titleGeneration !== undefined) {
    if (typeof body.titleGeneration !== 'object' || body.titleGeneration === null) {
      return c.json({ error: 'titleGeneration must be an object' }, 400);
    }
    if (body.titleGeneration.enabled !== undefined && typeof body.titleGeneration.enabled !== 'boolean') {
      return c.json({ error: 'titleGeneration.enabled must be a boolean' }, 400);
    }
    if (body.titleGeneration.chain !== undefined) {
      if (!Array.isArray(body.titleGeneration.chain) || body.titleGeneration.chain.length > 10) {
        return c.json({ error: 'titleGeneration.chain must be an array (max 10)' }, 400);
      }
      for (const entry of body.titleGeneration.chain) {
        if (!entry.provider || !entry.model) {
          return c.json({ error: 'Each chain entry must have provider and model' }, 400);
        }
        if (!isValidProvider(entry.provider, current.claude.customProviders)) {
          return c.json({ error: `Invalid provider in chain: ${entry.provider}` }, 400);
        }
      }
    }
  }
  if (body.notifications !== undefined) {
    if (typeof body.notifications !== 'object' || body.notifications === null) {
      return c.json({ error: 'notifications must be an object' }, 400);
    }
    const n = body.notifications as Record<string, unknown>;
    if (n.enabled !== undefined && typeof n.enabled !== 'boolean') {
      return c.json({ error: 'notifications.enabled must be a boolean' }, 400);
    }
    if (n.soundEnabled !== undefined && typeof n.soundEnabled !== 'boolean') {
      return c.json({ error: 'notifications.soundEnabled must be a boolean' }, 400);
    }
    if (n.soundVolume !== undefined) {
      const v = Number(n.soundVolume);
      if (!Number.isFinite(v) || v < 0 || v > 1) {
        return c.json({ error: 'notifications.soundVolume must be 0-1' }, 400);
      }
    }
    if (n.onlyWhenUnfocused !== undefined && typeof n.onlyWhenUnfocused !== 'boolean') {
      return c.json({ error: 'notifications.onlyWhenUnfocused must be a boolean' }, 400);
    }
    if (n.titleTemplate !== undefined) {
      if (typeof n.titleTemplate !== 'string' || n.titleTemplate.trim().length === 0 || n.titleTemplate.length > 200) {
        return c.json({ error: 'notifications.titleTemplate must be a non-empty string up to 200 chars' }, 400);
      }
    }
    if (n.bodyTemplate !== undefined) {
      if (typeof n.bodyTemplate !== 'string' || n.bodyTemplate.trim().length === 0 || n.bodyTemplate.length > 500) {
        return c.json({ error: 'notifications.bodyTemplate must be a non-empty string up to 500 chars' }, 400);
      }
    }
    if (n.minDurationMs !== undefined) {
      const v = Number(n.minDurationMs);
      if (!Number.isInteger(v) || v < 0 || v > 86_400_000) {
        return c.json({ error: 'notifications.minDurationMs must be an integer between 0 and 86400000' }, 400);
      }
    }
    if (n.dedupeWindowMs !== undefined) {
      const v = Number(n.dedupeWindowMs);
      if (!Number.isInteger(v) || v < 0 || v > 600_000) {
        return c.json({ error: 'notifications.dedupeWindowMs must be an integer between 0 and 600000' }, 400);
      }
    }
    if (n.clickAction !== undefined && !VALID_NOTIFICATION_CLICK_ACTIONS.includes(n.clickAction as NotificationClickAction)) {
      return c.json({ error: 'notifications.clickAction is invalid' }, 400);
    }
    if (n.requireInteraction !== undefined && typeof n.requireInteraction !== 'boolean') {
      return c.json({ error: 'notifications.requireInteraction must be a boolean' }, 400);
    }
    if (n.soundSource !== undefined && !isValidSoundSource(n.soundSource)) {
      return c.json({ error: 'notifications.soundSource must be builtin or custom' }, 400);
    }
    if (n.builtinSound !== undefined && !isValidBuiltInSoundId(n.builtinSound)) {
      return c.json({ error: 'notifications.builtinSound is invalid' }, 400);
    }
    if (n.customSoundDataUrl !== undefined) {
      if (n.customSoundDataUrl !== null && typeof n.customSoundDataUrl !== 'string') {
        return c.json({ error: 'notifications.customSoundDataUrl must be a string' }, 400);
      }
      if (
        typeof n.customSoundDataUrl === 'string'
        && (
          !n.customSoundDataUrl.startsWith('data:audio/')
          || n.customSoundDataUrl.length > MAX_CUSTOM_SOUND_DATA_URL_LENGTH
        )
      ) {
        return c.json({ error: 'notifications.customSoundDataUrl must be a short audio data URL' }, 400);
      }
    }
    if (n.customSoundName !== undefined) {
      if (n.customSoundName !== null && typeof n.customSoundName !== 'string') {
        return c.json({ error: 'notifications.customSoundName must be a string' }, 400);
      }
      if (typeof n.customSoundName === 'string' && n.customSoundName.length > 120) {
        return c.json({ error: 'notifications.customSoundName too long' }, 400);
      }
    }
  }

  const updated: AppSettings = {
    ...current,
    claude: {
      ...current.claude,
      ...(body.claude?.provider !== undefined && { provider: body.claude.provider }),
      ...(body.claude?.authMode !== undefined && { authMode: body.claude.authMode }),
      ...(body.claude?.model !== undefined && { model: body.claude.model }),
      ...(body.claude?.baseUrl !== undefined && { baseUrl: body.claude.baseUrl || undefined }),
      ...(body.claude?.skipPermissions !== undefined && { skipPermissions: !!body.claude.skipPermissions }),
      ...(body.claude?.effortLevel !== undefined && { effortLevel: body.claude.effortLevel }),
      ...(body.claude?.maxTurns !== undefined && { maxTurns: Number(body.claude.maxTurns) || 0 }),
    },
    ...(body.general !== undefined && {
      general: {
        ...current.general,
        ...(body.general?.telemetry !== undefined && { telemetry: body.general.telemetry }),
      },
    }),
    ...(body.developer !== undefined && {
      developer: {
        ...(current.developer ?? DEFAULT_DEVELOPER_SETTINGS),
        ...body.developer,
      },
    }),
    ...(body.dangerDetector !== undefined && {
      dangerDetector: {
        ...(current.dangerDetector ?? DEFAULT_DANGER_SETTINGS),
        ...body.dangerDetector,
      },
    }),
    ...(body.titleGeneration !== undefined && {
      titleGeneration: {
        ...current.titleGeneration,
        ...body.titleGeneration,
      },
    }),
    ...(body.notifications !== undefined && {
      notifications: normalizeNotificationSettings({
        ...(current.notifications ?? DEFAULT_NOTIFICATION_SETTINGS),
        ...body.notifications,
      }),
    }),
    version: current.version,
  };

  if (body.claude?.authMode !== undefined) {
    const targetProvider = (body.claude?.provider ?? updated.claude.provider ?? 'anthropic') as ProviderId;
    if (!updated.claude.providerCredentials) updated.claude.providerCredentials = { ...current.claude.providerCredentials };
    const existing = updated.claude.providerCredentials?.[targetProvider] ?? { authMode: 'api_key' as const };
    updated.claude.providerCredentials[targetProvider] = { ...existing, authMode: body.claude.authMode };
  }

  if (body.claude?.apiKey !== undefined) {
    const newKey = body.claude.apiKey;
    if (newKey === '' || newKey === null) {
      updated.claude.apiKey = undefined;
    } else if (newKey.startsWith('••')) {
      updated.claude.apiKey = current.claude.apiKey;
    } else {
      updated.claude.apiKey = newKey;
    }
  }

  if (body.claude?.providerApiKeys !== undefined) {
    const merged = { ...current.claude.providerApiKeys };
    for (const [pid, val] of Object.entries(body.claude.providerApiKeys as Record<string, string | null>)) {
      if (val === null || val === '') {
        delete merged[pid as ProviderId];
      } else if (typeof val === 'string' && val.startsWith('••')) {
        // masked passback — keep original
      } else {
        merged[pid as ProviderId] = val as string;
      }
    }
    updated.claude.providerApiKeys = Object.keys(merged).length > 0 ? merged : undefined;

    if (merged.anthropic) {
      updated.claude.apiKey = merged.anthropic;
    }

    if (!updated.claude.providerCredentials) updated.claude.providerCredentials = { ...current.claude.providerCredentials };
    for (const [pid, val] of Object.entries(body.claude.providerApiKeys as Record<string, string | null>)) {
      const p = pid as ProviderId;
      if (val === null || val === '') {
        if (updated.claude.providerCredentials?.[p]) {
          updated.claude.providerCredentials[p] = { ...updated.claude.providerCredentials[p]!, apiKey: undefined };
        }
      } else if (typeof val === 'string' && val.startsWith('••')) {
        // masked passback — don't touch providerCredentials
      } else {
        const existing = updated.claude.providerCredentials?.[p] ?? { authMode: 'api_key' as const };
        updated.claude.providerCredentials[p] = { ...existing, apiKey: val as string };
      }
    }
  }

  if (body.claude?.providerModels !== undefined) {
    updated.claude.providerModels = {
      ...current.claude.providerModels,
      ...body.claude.providerModels,
    };
  }

  if (body.claude?.providerModelLibrary !== undefined) {
    updated.claude.providerModelLibrary = {
      ...current.claude.providerModelLibrary,
      ...body.claude.providerModelLibrary,
    };
  }

  if (body.claude?.providerBaseUrls !== undefined) {
    const merged = { ...current.claude.providerBaseUrls };
    for (const [pid, val] of Object.entries(body.claude.providerBaseUrls as Record<string, string | null>)) {
      if (val === null || val === '') {
        delete merged[pid as ProviderId];
      } else {
        merged[pid as ProviderId] = val as string;
      }
    }
    updated.claude.providerBaseUrls = Object.keys(merged).length > 0 ? merged : undefined;
  }

  if (body.claude?.openaiReasoningEffort !== undefined) {
    updated.claude.openaiReasoningEffort = body.claude.openaiReasoningEffort;
  }
  if (body.claude?.openaiFastMode !== undefined) {
    updated.claude.openaiFastMode = body.claude.openaiFastMode;
  }
  if (body.claude?.openaiOAuthEnabled !== undefined) {
    updated.claude.openaiOAuthEnabled = body.claude.openaiOAuthEnabled;
    if (!body.claude.openaiOAuthEnabled && updated.claude.providerCredentials?.openai) {
      const o = updated.claude.providerCredentials.openai;
      updated.claude.providerCredentials.openai = { ...o, authMode: 'api_key' };
    }
  }
  if (body.claude?.customProviders !== undefined) {
    const incoming = body.claude.customProviders as CustomProviderConfig[];
    const existing = current.claude.customProviders ?? [];
    updated.claude.customProviders = incoming.map((cp) => {
      if (cp.apiKey?.startsWith('••') && cp.id) {
        const prev = existing.find((e) => e.id === cp.id);
        return { ...cp, apiKey: prev?.apiKey ?? cp.apiKey };
      }
      return cp;
    });
  }

  await saveSettings(updated);
  return c.json({ success: true });
});

// ─── GET /health — system health check ──────────────────────────

app.get('/health', async (c) => {
  const cliHealth = checkClaudeCliHealth();

  const settings = await getSettings();
  const claude = settings.claude;
  const provider = claude.provider ?? 'anthropic';
  const cred = getCredential(claude, provider);
  const authMode = getEffectiveAuthMode(claude, provider);
  const hasApiKey = !!(
    cred.apiKey ||
    authMode === 'oauth' ||
    provider === 'ollama'
  );

  return c.json({
    cli: {
      ok: cliHealth.ok,
      diagnostic: cliHealth.diagnostic,
    },
    apiKey: {
      ok: hasApiKey,
      provider,
      diagnostic: hasApiKey
        ? undefined
        : `未配置 ${provider} 的 API Key。请在设置页面填写 API 密钥或完成 OAuth 认证。`,
    },
  });
});

// ─── GET /desktop-cli-debug — Claude CLI env / invocation diagnostics ──

app.get('/desktop-cli-debug', async (c) => {
  const invocation = resolveClaudeCliInvocation();
  const health = checkClaudeCliHealth();

  return c.json({
    env: {
      PATH: process.env.PATH ?? '',
      CLAUDE_CLI_PATH: process.env.CLAUDE_CLI_PATH ?? '',
      NODE_PATH: process.env.NODE_PATH ?? '',
    },
    invocation,
    health,
  });
});

// ─── GET /auth-status — check auth state ────────────────────────

app.get('/auth-status', async (c) => {
  const provider = (c.req.query('provider') ?? 'anthropic') as ProviderId;

  const settings = await getSettings();
  const claude = settings.claude;
  const authMode = getEffectiveAuthMode(claude, provider);
  const cred = getCredential(claude, provider);

  if (authMode === 'api_key') {
    const hasKey = Boolean(cred.apiKey);
    return c.json({
      provider,
      authMode: 'api_key',
      authState: (hasKey ? 'authenticated' : 'not_authenticated') as AuthState,
      authenticated: hasKey,
      hasApiKey: hasKey,
    });
  }

  if (provider === 'openai') {
    try {
      const { execCodex } = await import('@/lib/codex-cli');
      const { stdout, stderr } = await execCodex(['login', 'status'], { timeout: 15_000 });
      const raw = (stdout + stderr).trim();
      const authState: AuthState = parseAuthState(raw);
      return c.json({
        provider,
        authMode: 'oauth',
        authState,
        authenticated: authState === 'authenticated',
        rawOutput: raw,
      });
    } catch (err) {
      const e = err as Error & { stdout?: string; stderr?: string };
      const raw = ((e.stdout ?? '') + (e.stderr ?? '')).trim();
      if (raw) {
        const authState: AuthState = parseAuthState(raw);
        if (authState !== 'unknown') {
          return c.json({ provider, authMode: 'oauth', authState, authenticated: authState === 'authenticated', rawOutput: raw });
        }
      }
      return c.json({
        provider,
        authMode: 'oauth',
        authState: 'unknown' as AuthState,
        authenticated: false,
        error: e.message || 'Codex CLI not available',
      });
    }
  }

  if (provider !== 'anthropic') {
    return c.json({
      provider,
      authMode,
      authState: 'unknown' as AuthState,
      authenticated: false,
      error: `OAuth not supported for provider: ${provider}`,
    });
  }

  const status = checkAuthFromCredentials();

  let authState: AuthState;
  if (status.authenticated) {
    authState = 'authenticated';
  } else if (status.expired) {
    authState = 'not_authenticated';
  } else {
    authState = 'not_authenticated';
  }

  return c.json({
    provider,
    authMode,
    authState,
    authenticated: status.authenticated,
    expired: status.expired,
    expiresAt: status.expiresAt,
  });
});

// ─── POST /auth-login — start OAuth flow ────────────────────────

function extractOAuthUrl(text: string): string | null {
  const httpsMatch = text.match(/https:\/\/[^\s"')\]]+/g);
  if (httpsMatch) {
    const authUrl = httpsMatch.find((u) => u.includes('auth.openai.com'));
    if (authUrl) return authUrl.trim();
  }
  return null;
}

function extractDeviceCode(text: string): string | null {
  const patterns = [
    /(?:code|enter)[:\s]+([A-Z0-9]{4,6}-[A-Z0-9]{4,8})/i,
    /([A-Z0-9]{4,6}-[A-Z0-9]{4,8})(?:\s|$|\.)/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

app.post('/auth-login', async (c) => {
  let provider: ProviderId = 'anthropic';
  try {
    const body = await c.req.json().catch(() => ({}));
    if (body.provider && typeof body.provider === 'string') {
      provider = body.provider as ProviderId;
    }
  } catch { /* use default */ }

  const appSettings = await getSettings();
  if (provider === 'anthropic') {
    return c.json(
      { error: 'Anthropic OAuth is disabled in this app. Use an API key in settings.' },
      403,
    );
  }
  if (provider === 'openai' && appSettings.claude.openaiOAuthEnabled !== true) {
    return c.json(
      { error: 'OpenAI OAuth is disabled. Turn on “OpenAI Codex OAuth” in AI settings first.' },
      403,
    );
  }

  const currentProvider = getLoginProvider();
  const currentProcess = getLoginProcess();

  if (currentProvider && currentProvider !== provider) {
    if (provider === 'openai' || currentProvider === 'openai') {
      if (currentProcess && !currentProcess.killed) {
        return c.json(
          { error: `Another login (${currentProvider}) is already in progress.` },
          409,
        );
      }
    }
    if (getPkceSession()) {
      return c.json(
        { error: `Another login (${currentProvider}) is already in progress.` },
        409,
      );
    }
  }

  if (currentProcess && !currentProcess.killed) {
    try { currentProcess.kill(); } catch { /* ignore */ }
    setLoginProcess(null);
  }
  setPkceSession(null);
  setCapturedLoginUrl(null);
  setCapturedLoginCode(null);

  try {
    setLoginProvider(provider);

    if (provider === 'openai') {
      try {
        const { spawnCodex } = await import('@/lib/codex-cli');
        const child = spawnCodex(['login'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, BROWSER: 'echo' },
        });

        setLoginProcess(child);

        let buffer = '';
        const collect = (chunk: Buffer) => {
          buffer += chunk.toString();
          const url = extractOAuthUrl(buffer);
          if (url) setCapturedLoginUrl(url);
          const code = extractDeviceCode(buffer);
          if (code) setCapturedLoginCode(code);
        };

        child.stdout?.on('data', collect);
        child.stderr?.on('data', collect);

        child.on('exit', () => { setLoginProcess(null); });
        child.on('error', () => { setLoginProcess(null); });

        return c.json({
          success: true,
          message: 'OpenAI login started. Poll /api/settings/auth-url for the device code.',
        });
      } catch {
        setLoginProvider(null);
        return c.json(
          { error: 'Codex CLI not available. Install @openai/codex globally.' },
          500,
        );
      }
    }

    return c.json({ error: 'OAuth login is only available for OpenAI Codex when enabled in settings.' }, 400);
  } catch (err) {
    setLoginProcess(null);
    setPkceSession(null);
    setCapturedLoginUrl(null);
    setCapturedLoginCode(null);
    setLoginProvider(null);
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to start login' },
      500,
    );
  }
});

// ─── POST /auth-code — exchange authorization code ──────────────

app.post('/auth-code', async (c) => {
  if (getPkceSession()) {
    setPkceSession(null);
    setLoginProvider(null);
    return c.json(
      { error: 'Anthropic OAuth login is no longer supported. Use an API key in settings.' },
      403,
    );
  }

  const { code } = await c.req.json() as { code?: string };

  const extracted = extractAuthCode(code ?? '');
  if (!extracted) {
    return c.json({ error: 'code is required' }, 400);
  }

  const provider = getLoginProvider();

  if (provider && provider !== 'anthropic') {
    return c.json(
      { error: `Manual code submission is not supported for ${provider}. Use the device code flow instead.` },
      400,
    );
  }

  const session = getPkceSession();
  if (!session) {
    return c.json(
      { error: 'No active OAuth session. Please click "Login" first.' },
      409,
    );
  }

  if (Date.now() - session.createdAt > 10 * 60 * 1000) {
    setPkceSession(null);
    setLoginProvider(null);
    return c.json(
      { error: 'OAuth session expired. Please click "Login" to start a new session.' },
      410,
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(extracted, session.codeVerifier);
    saveTokens(tokens);

    await setCredential('anthropic', {
      authMode: 'oauth',
      oauth: {
        tokenFile: path.join(os.homedir(), '.claude', '.credentials.json'),
        lastStatus: 'authenticated',
        lastCheckedAt: Date.now(),
      },
      lastVerifiedAt: Date.now(),
    });

    setPkceSession(null);
    setLoginProvider(null);

    return c.json({
      success: true,
      message: 'Authentication successful. Tokens saved.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Token exchange failed';

    if (msg.includes('invalid_grant') || msg.includes('expired')) {
      setPkceSession(null);
      setLoginProvider(null);
      return c.json(
        { error: 'Authorization code expired or already used. Please click "Login" to try again.' },
        400,
      );
    }

    return c.json({ error: msg }, 500);
  }
});

// ─── GET /auth-url — poll for OAuth login URL / device code ─────

app.get('/auth-url', async (c) => {
  const provider = getLoginProvider();
  const pkce = getPkceSession();
  const loginProcess = getLoginProcess();

  const loginUrl = provider === 'anthropic'
    ? (pkce?.authorizeUrl ?? null)
    : getCapturedLoginUrl();

  return c.json({
    loginUrl,
    loginCode: getCapturedLoginCode(),
    loginProvider: provider,
    sessionActive: provider === 'anthropic'
      ? Boolean(pkce)
      : Boolean(loginProcess && !loginProcess.killed),
  });
});

// ─── POST /import — import data from JSON ───────────────────────

app.post('/import', async (c) => {
  try {
    const body = await c.req.json();

    if (!body.version || !body.data) {
      return c.json({ error: 'Invalid export format: missing version or data' }, 400);
    }

    const { data } = body;

    const dataDir = getDataDir();
    const timestamp = Date.now();
    const backupDir = path.join(dataDir, `_backup_${timestamp}`);
    await fs.mkdir(backupDir, { recursive: true });

    const filesToBackup = [getProjectsPath(), getProjectsIndexPath(), getAgentsPath(), getAgentChatSessionsPath()];
    for (const src of filesToBackup) {
      try {
        await fs.stat(src);
        await fs.copyFile(src, path.join(backupDir, path.basename(src)));
      } catch { /* file doesn't exist */ }
    }

    const messagesDir = getAgentChatMessagesDir();
    try {
      const msgBackup = path.join(backupDir, 'chat-messages');
      await fs.mkdir(msgBackup, { recursive: true });
      const msgFiles = await fs.readdir(messagesDir);
      for (const file of msgFiles) {
        if (file.endsWith('.jsonl')) {
          await fs.copyFile(path.join(messagesDir, file), path.join(msgBackup, file));
        }
      }
    } catch { /* messages dir doesn't exist */ }

    const legacyBoardRoots = [
      { root: getLegacyBoardDataDir(), backupSubdir: 'legacy-board' },
      { root: getLegacyBoardPreviousDir(), backupSubdir: 'legacy-board-previous' },
    ];
    for (const { root, backupSubdir } of legacyBoardRoots) {
      try {
        const boardBackup = path.join(backupDir, backupSubdir);
        await fs.mkdir(boardBackup, { recursive: true });
        const files = await fs.readdir(root);
        for (const file of files) {
          if (file.endsWith('.json')) {
            await fs.copyFile(path.join(root, file), path.join(boardBackup, file));
          }
        }
      } catch { /* dir doesn't exist */ }
    }

    const stats = { legacyBoard: 0, agents: 0 };

    if (data.projects) {
      const raw = data.projects as { projects?: unknown };
      if (Array.isArray(raw.projects)) {
        await writeProjectIndex({ projects: raw.projects as ProjectEntry[] });
      } else if (raw.projects && typeof raw.projects === 'object') {
        const record = raw.projects as Record<string, ProjectConfig>;
        const now = new Date().toISOString();
        const entries: ProjectEntry[] = Object.entries(record).map(([key, config]) => {
          const safe = key.replace(/[^a-zA-Z0-9_-]/g, '') || key;
          return {
            key: safe,
            name: config.name,
            path: config.path,
            location: 'local' as const,
            ...(config.type && { techStack: config.type as ProjectEntry['techStack'] }),
            ...(config.description && { description: config.description }),
            ...(config.defaultBranch && { repository: { defaultBranch: config.defaultBranch } }),
            ...((config.webCommand || config.webUrl) && {
              devServer: {
                ...(config.webCommand && { command: config.webCommand }),
                ...(config.webUrl && { url: config.webUrl }),
              },
            }),
            createdAt: now,
          };
        });
        await writeProjectIndex({ projects: entries });
      } else {
        await writeJsonFile(getProjectsPath(), data.projects);
      }
    }
    if (data.agents) {
      const imported = data.agents as { agents?: Agent[] };
      const importedAgents = Array.isArray(imported.agents) ? imported.agents : [];
      const existingData = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });
      const mergedAgents = [...existingData.agents];

      for (const incoming of importedAgents) {
        const idx = mergedAgents.findIndex(a => a.id === incoming.id);
        if (idx >= 0) {
          mergedAgents[idx] = { ...mergedAgents[idx], ...incoming };
        } else {
          mergedAgents.push(incoming);
        }
      }

      const builtinAgents = await getDefaultAgents();
      for (const defaultAgent of builtinAgents) {
        if (!mergedAgents.some((a: Agent) => a.id === defaultAgent.id)) {
          mergedAgents.unshift(defaultAgent);
        }
      }

      for (const agent of mergedAgents) {
        if (agent.systemPrompt) {
          await writePromptFile(agent.id, agent.systemPrompt);
          delete agent.systemPrompt;
        }
      }
      await writeJsonFile(getAgentsPath(), { agents: mergedAgents });
      invalidateAgentsCache();
      stats.agents = mergedAgents.length;
    }
    if (data.agentChatSessions) {
      const imported = data.agentChatSessions as { sessions?: AgentChatSession[] };
      const importedSessions = Array.isArray(imported.sessions) ? imported.sessions : [];
      if (importedSessions.length > 0) {
        await importSessionsWithMessages(importedSessions);
      }
    }

    // 旧导出中的 legacyBoard 域仅占位，不再写入磁盘树形看板文件

    return c.json({
      success: true,
      backupDir: `_backup_${timestamp}`,
      stats,
    });
  } catch (error) {
    const enc = documentTextWriteErrorResponse(error);
    if (enc) return c.json({ error: enc.body.error, code: enc.body.code, issues: enc.body.issues }, enc.status);
    console.error('Import failed:', error);
    return c.json({ error: 'Import failed' }, 500);
  }
});

// ─── GET /export — export all data ──────────────────────────────

app.get('/export', async (c) => {
  try {
    const [projectIndex, agents] = await Promise.all([
      readProjectIndex(),
      readJsonFile(getAgentsPath(), {}),
    ]);

    const sessionMetas = await listAllSessions();
    const fullSessions = await Promise.all(
      sessionMetas.map(async (meta) => {
        const messages = await readMessages(meta.id);
        return { ...meta, messages };
      }),
    );
    const agentChatSessions = { sessions: fullSessions };

    const agentsData = agents as AgentsData;
    if (agentsData.agents) {
      await Promise.all(
        agentsData.agents.map(async (agent: Agent) => {
          agent.systemPrompt = await resolveSystemPrompt(agent.id, agent.systemPrompt);
        }),
      );
    }

    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        projects: projectIndex,
        agents,
        agentChatSessions,
        legacyBoard: {} as Record<string, unknown>,
      },
    };

    const json = JSON.stringify(exportData, null, 2);
    const date = new Date().toISOString().slice(0, 10);

    return new Response(json, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename=projectpilot-export-${date}.json`,
      },
    });
  } catch (error) {
    console.error('Export failed:', error);
    return c.json({ error: 'Export failed' }, 500);
  }
});

// ─── POST /clear — clear data ───────────────────────────────────

type ClearTarget = 'sessions' | 'legacyBoard' | 'all';
const VALID_TARGETS: ClearTarget[] = ['sessions', 'legacyBoard', 'all'];

app.post('/clear', async (c) => {
  try {
    const body = await c.req.json();
    const target = body.target as ClearTarget;

    if (!VALID_TARGETS.includes(target)) {
      return c.json({ error: 'Invalid target. Must be: sessions, legacyBoard, or all' }, 400);
    }

    const dataDir = getDataDir();
    const timestamp = Date.now();
    const bkDir = path.join(dataDir, `_backup_${timestamp}`);
    await fs.mkdir(bkDir, { recursive: true });

    async function backupFile(filePath: string) {
      try {
        await fs.stat(filePath);
        const fileName = path.relative(dataDir, filePath);
        const dest = path.join(bkDir, fileName);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(filePath, dest);
      } catch { /* file doesn't exist */ }
    }

    async function backupDirRecursive(dirPath: string) {
      try {
        const files = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of files) {
          const src = path.join(dirPath, entry.name);
          if (entry.isFile()) {
            await backupFile(src);
          } else if (entry.isDirectory()) {
            await backupDirRecursive(src);
          }
        }
      } catch { /* dir doesn't exist */ }
    }

    const cleared = { sessions: 0, legacyBoard: 0 };

    if (target === 'sessions' || target === 'all') {
      const sessionsData = await readJsonFile<AgentChatSessionsData>(
        getAgentChatSessionsPath(), { sessions: [] },
      );
      cleared.sessions = sessionsData.sessions.length;

      await backupFile(getAgentChatSessionsPath());
      await backupDirRecursive(getAgentChatMessagesDir());

      await writeJsonFile(getAgentChatSessionsPath(), { sessions: [] });
      await deleteAllMessageFiles();

      try {
        const promptsDir = getPromptsDir();
        const entries = await fs.readdir(promptsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.endsWith('.runtime')) {
            await fs.rm(path.join(promptsDir, entry.name), { recursive: true, force: true }).catch(() => {});
          }
        }
      } catch { /* prompts dir may not exist */ }
    }

    if (target === 'legacyBoard' || target === 'all') {
      await backupDirRecursive(getLegacyBoardDataDir());
      await backupDirRecursive(getLegacyBoardPreviousDir());
      await removeLegacyBoardDataDirs();
    }

    if (target === 'all') {
      await backupFile(getAgentsPath());
      const agentsData = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });
      const builtinAgents = await getDefaultAgents();
      for (const defaultAgent of builtinAgents) {
        if (!agentsData.agents.some(a => a.id === defaultAgent.id)) {
          agentsData.agents.unshift(defaultAgent);
        }
      }
      for (const agent of agentsData.agents) {
        if (agent.archived) {
          agent.archived = undefined;
          agent.archivedAt = undefined;
        }
      }
      await writeJsonFile(getAgentsPath(), agentsData);
      invalidateAgentsCache();
    }

    return c.json({
      success: true,
      backupDir: `_backup_${timestamp}`,
      cleared,
    });
  } catch (error) {
    console.error('Clear data failed:', error);
    return c.json({ error: 'Clear failed' }, 500);
  }
});

// ─── GET /data-info — data directory info ───────────────────────

app.get('/data-info', async (c) => {
  try {
    const dataDir = getDataDir();
    let totalSize = 0;
    let fileCount = 0;

    async function walkDir(dir: string) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('_backup_')) continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isFile()) {
            const stat = await fs.stat(fullPath);
            totalSize += stat.size;
            fileCount++;
          } else if (entry.isDirectory()) {
            await walkDir(fullPath);
          }
        }
      } catch { /* dir doesn't exist */ }
    }

    await walkDir(dataDir);

    let sizeStr: string;
    if (totalSize < 1024) {
      sizeStr = `${totalSize} B`;
    } else if (totalSize < 1024 * 1024) {
      sizeStr = `${(totalSize / 1024).toFixed(1)} KB`;
    } else {
      sizeStr = `${(totalSize / (1024 * 1024)).toFixed(1)} MB`;
    }

    return c.json({
      dataDir,
      diskUsage: {
        total: sizeStr,
        bytes: totalSize,
        files: fileCount,
      },
    });
  } catch (error) {
    console.error('Data info failed:', error);
    return c.json({ error: 'Failed to get data info' }, 500);
  }
});

// ─── GET /openai-models — OpenAI model catalog ──────────────────

app.get('/openai-models', async (c) => {
  try {
    const catalog = await listOpenAIModels();
    return c.json(catalog);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to list OpenAI models' },
      500,
    );
  }
});

// ─── GET /aggregate-models — 各供应商真实 /v1/models（及 Ollama tags、Codex RPC）聚合 ──

let aggregateModelsHttpCache: { at: number; data: AggregateLiveModelsResult } | null = null;
/** 全供应商聚合拉取成本高；短时缓存减轻多标签/设置页+聊天同时命中上游导致的限流 */
const AGGREGATE_MODELS_HTTP_CACHE_MS = 180_000;
const PROBE_SUPPLIER_HTTP_CACHE_MS = 180_000;
const probeSupplierHttpCache = new Map<
  string,
  { at: number; row: Awaited<ReturnType<typeof probeSupplierLive>>['row'] }
>();

app.get('/aggregate-models', async (c) => {
  const now = Date.now();
  const bypassCache =
    c.req.query('refresh') === '1' ||
    c.req.query('nocache') === '1' ||
    c.req.header('cache-control') === 'no-cache';
  if (
    !bypassCache &&
    aggregateModelsHttpCache &&
    now - aggregateModelsHttpCache.at < AGGREGATE_MODELS_HTTP_CACHE_MS
  ) {
    return c.json(aggregateModelsHttpCache.data);
  }
  const result = await getAggregateLiveModels();
  aggregateModelsHttpCache = { at: now, data: result };
  return c.json(result);
});

// ─── POST /probe-supplier — 单供应商可用性（输入框旁自动检测） ──

app.post('/probe-supplier', async (c) => {
  let body: {
    providerId?: string;
    apiKey?: string | null;
    ollamaBaseUrl?: string | null;
    /** 为 true 时在响应中附带 modelItems，供设置页单供应商刷新模型列表（不走 HTTP 缓存） */
    includeModels?: boolean;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  const pid = body.providerId as ProviderId | undefined;
  if (!pid || typeof pid !== 'string') {
    return c.json({ ok: false, error: 'providerId required' }, 400);
  }
  const includeModels = body.includeModels === true;
  // 供应商可用性探测缓存（2 分钟），避免前端频繁输入时重复命中上游 API。
  // key 不记录明文用途，仅在本进程内做短期去重。
  const keyApi = typeof body.apiKey === 'string'
    ? (body.apiKey.startsWith('••') ? '(masked)' : body.apiKey)
    : '(saved)';
  const keyBase = typeof body.ollamaBaseUrl === 'string' ? body.ollamaBaseUrl.trim() : '';
  const cacheKey = `${pid}|${keyApi}|${keyBase}`;
  const cached = probeSupplierHttpCache.get(cacheKey);
  const now = Date.now();
  // 失败结果不应长期缓存：否则用户改 Key / 我们改默认域名后，前端仍拿到 3 分钟前的 error
  if (
    !includeModels &&
    cached &&
    cached.row.status === 'ok' &&
    now - cached.at < PROBE_SUPPLIER_HTTP_CACHE_MS
  ) {
    return c.json({ ok: true, row: cached.row });
  }
  try {
    const result = await probeSupplierLive(pid, body.apiKey, {
      ollamaBaseUrl: typeof body.ollamaBaseUrl === 'string' ? body.ollamaBaseUrl : undefined,
    });
    probeSupplierHttpCache.set(cacheKey, { at: now, row: result.row });
    if (includeModels) {
      return c.json({ ok: true, row: result.row, modelItems: result.modelItems });
    }
    return c.json({ ok: true, row: result.row });
  } catch (err) {
    return c.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'probe failed',
      },
      500,
    );
  }
});

// ─── POST /test-connection — test AI connection ─────────────────

const TEST_TIMEOUT_MS = 60_000;
const OAUTH_CHECK_TIMEOUT_MS = 25_000;

async function testOAuthConnection(provider: ProviderId) {
  try {
    let output: string;

    if (provider === 'openai') {
      const { execCodex } = await import('@/lib/codex-cli');
      const { stdout, stderr } = await execCodex(['login', 'status'], { timeout: OAUTH_CHECK_TIMEOUT_MS });
      output = (stdout + stderr).trim();
    } else if (provider === 'anthropic') {
      const { stdout, stderr } = await execClaude(['auth', 'status'], { timeout: OAUTH_CHECK_TIMEOUT_MS });
      output = (stdout + stderr).trim();
    } else {
      return { ok: false, error: `OAuth 不支持供应商: ${provider}` };
    }

    if (parseAuthStatusText(output)) {
      return { ok: true };
    }
    return { ok: false, error: output || '尚未完成 OAuth 认证' };
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string };
    const output = ((e.stdout || '') + (e.stderr || '')).trim();
    return { ok: false, error: output || `CLI 不可用或未安装: ${e.message}` };
  }
}

async function testOllamaConnection(
  baseUrl: string | undefined,
  preset: { baseUrl?: string },
) {
  const url = (baseUrl || preset.baseUrl || 'http://localhost:11434').replace(/\/$/, '') + '/api/tags';
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: res.status === 404 ? 'Ollama 未运行或地址错误' : text || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

async function runSingleTest(
  provider: ProviderId,
  apiKey: string,
  model: string,
  baseUrl: string,
  _current: Awaited<ReturnType<typeof getSettings>>,
): Promise<{ ok: boolean; error?: string }> {
  // 重要：这里故意不走 agentChatManager.start（不创建测试会话，不污染聊天历史）。
  // 仅发送最小 messages 请求做连通性判断，属于系统探测，不是用户功能对话。
  const root = baseUrl.replace(/\/+$/, '');
  const url = /\/v1$/i.test(root) ? `${root}/messages` : `${root}/v1/messages`;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  // 内置第三方里除了 openrouter 之外基本都走 x-api-key；openrouter/custom-AUTH_TOKEN 走 Bearer。
  const isBearerProvider = provider === 'openrouter' || provider.startsWith('custom-');
  if (isBearerProvider) headers.authorization = `Bearer ${apiKey}`;
  else headers['x-api-key'] = apiKey;

  const body = {
    model,
    max_tokens: 8,
    messages: [{ role: 'user', content: 'ok' }],
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function testConversationConnection(
  provider: ProviderId,
  apiKey: string,
  model: string,
  baseUrl: string | undefined,
) {
  const settings = await getSettings();
  const preset = getProviderPreset(provider as ProviderId, settings.claude.customProviders);
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key || key.startsWith('••')) {
    return { ok: false, error: '请先填写 API 密钥', status: 400 as const };
  }

  const current = await getSettings();
  const savedProviderUrl = current.claude.providerBaseUrls?.[provider];
  const userProvidedUrl = baseUrl?.trim() || undefined;
  const customBaseUrl = provider.startsWith('custom-')
    ? current.claude.customProviders?.find((cp) => cp.id === provider)?.baseUrl
    : undefined;
  const modelId = typeof model === 'string' ? model.trim() : '';

  if (provider === 'kimi') {
    const candidates = getKimiCandidateBaseUrls(
      modelId,
      userProvidedUrl || savedProviderUrl || customBaseUrl,
    );
    if (!candidates.length) {
      return { ok: false, error: '缺少 API 地址', status: 400 as const };
    }

    for (const url of candidates) {
      const result = await runSingleTest(provider, key, modelId, url, current);
      if (result.ok) {
        return { ok: true, baseUrl: url };
      }
    }

    return {
      ok: false,
      error: 'Kimi 渠道均不可用，请确认所选模型对应的 API Key 与 Base URL',
    };
  }

  const effectiveBaseUrl = userProvidedUrl || savedProviderUrl || customBaseUrl;
  if (effectiveBaseUrl) {
    const result = await runSingleTest(provider, key, modelId, effectiveBaseUrl, current);
    if (result.ok) {
      return { ok: true };
    }
    return { ok: false, error: result.error };
  }

  const candidates = preset.candidateBaseUrls;
  if (!candidates?.length) {
    return { ok: false, error: '缺少 API 地址', status: 400 as const };
  }

  for (const url of candidates) {
    const result = await runSingleTest(provider, key, modelId, url, current);
    if (result.ok) {
      return { ok: true, baseUrl: url };
    }
  }

  return {
    ok: false,
    error: `所有候选地址均不可用，请检查 API 密钥或网络`,
  };
}

app.post('/test-connection', async (c) => {
  try {
    const body = await c.req.json();
    const { provider, authMode } = body;
    let { apiKey, model, baseUrl } = body;

    if (!provider || typeof provider !== 'string') {
      return c.json({ ok: false, error: 'Missing provider' }, 400);
    }

    const settings = await getSettings();
    const preset = getProviderPreset(provider as ProviderId, settings.claude.customProviders);

    if (typeof apiKey === 'string' && apiKey.startsWith('••')) {
      const savedKey = getProviderScopedApiKey(settings.claude, provider as ProviderId);
      if (savedKey) apiKey = savedKey;
      if (!model) model = getProviderScopedModel(settings.claude, provider as ProviderId);
      if (!baseUrl) baseUrl = settings.claude.providerBaseUrls?.[provider as ProviderId] || settings.claude.baseUrl;
    }

    if (authMode === 'oauth') {
      if (provider === 'anthropic') {
        return c.json({ ok: false, error: 'Anthropic OAuth is disabled. Use an API key.' });
      }
      if (provider === 'openai' && settings.claude.openaiOAuthEnabled !== true) {
        return c.json({ ok: false, error: 'OpenAI OAuth is disabled in settings.' });
      }
      const result = await testOAuthConnection(provider as ProviderId);
      return c.json(result, result.ok ? 200 : 200);
    }

    if (provider === 'ollama') {
      const result = await testOllamaConnection(baseUrl, preset);
      return c.json(result);
    }

    const result = await testConversationConnection(
      provider as ProviderId,
      apiKey,
      model,
      baseUrl,
    );
    const status = 'status' in result ? result.status : 200;
    return c.json(result, status as 200);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const isTimeout = errMsg.includes('timeout') || errMsg.includes('abort');
    return c.json({
      ok: false,
      error: isTimeout ? '请求超时，请检查网络或 API 地址' : errMsg,
    });
  }
});

// ─── POST /test-title-entry — test title generation chain entry ─

app.post('/test-title-entry', async (c) => {
  try {
    const body = await c.req.json() as Partial<TitleGenerationChainEntry>;
    const { provider, model } = body;

    if (!provider || typeof provider !== 'string') {
      return c.json({ ok: false, error: 'Missing provider' }, 400);
    }
    if (!model || typeof model !== 'string') {
      return c.json({ error: 'Missing model' }, 400);
    }

    const result = await testTitleChainEntry({ provider, model });
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg, latencyMs: 0 });
  }
});

// ─── GET /model-health — read health check results ──────────────

app.get('/model-health', async (c) => {
  const data = await readHealthResults();
  if (!data) {
    return c.json({ ok: true, data: null, message: 'No health check results yet' });
  }

  const entries = Object.entries(data.results);
  const summary = {
    total: entries.length,
    ok: entries.filter(([, r]) => r.status === 'ok').length,
    failed: entries.filter(([, r]) => r.status === 'failed').length,
    skipped: entries.filter(([, r]) => r.status === 'skipped').length,
  };

  return c.json({ ok: true, data, summary });
});

// ─── POST /model-health — trigger health check ─────────────────

app.post('/model-health', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const providerFilter = body.provider as ProviderId | undefined;

    const result = await runHealthCheck({ providerFilter });

    const entries = Object.entries(result.results);
    const summary = {
      total: entries.length,
      ok: entries.filter(([, r]) => r.status === 'ok').length,
      failed: entries.filter(([, r]) => r.status === 'failed').length,
      skipped: entries.filter(([, r]) => r.status === 'skipped').length,
    };

    return c.json({ ok: true, data: result, summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
