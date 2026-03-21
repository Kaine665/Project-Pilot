import { NextRequest, NextResponse } from 'next/server';
import { getSettings, saveSettings } from '@/lib/settings-manager';
import {
  isValidBuiltInSoundId,
  isValidSoundSource,
  MAX_CUSTOM_SOUND_DATA_URL_LENGTH,
  normalizeNotificationSettings,
} from '@/lib/notification/notification-sound-presets';
import { normalizeOpenAIFastMode } from '@/lib/openai-fast-mode';
import { OPENAI_REASONING_EFFORTS } from '@/lib/openai-reasoning-effort';
import type { ClaudeAuthMode, ProviderId, EffortLevel, OpenAIReasoningEffort, AppSettings, DangerCategory, DangerActionLevel, CustomProviderConfig, NotificationClickAction } from '@/types';
import { DEFAULT_DANGER_SETTINGS, DEFAULT_NOTIFICATION_SETTINGS, BUILT_IN_PROVIDER_IDS } from '@/types';

const VALID_AUTH_MODES: ClaudeAuthMode[] = ['api_key', 'oauth'];
const VALID_EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high'];
const VALID_OPENAI_EFFORTS: OpenAIReasoningEffort[] = [...OPENAI_REASONING_EFFORTS];
const VALID_NOTIFICATION_CLICK_ACTIONS: NotificationClickAction[] = ['open_session', 'focus_app', 'none'];

function isValidProvider(id: string, customProviders?: CustomProviderConfig[]): id is ProviderId {
  if (BUILT_IN_PROVIDER_IDS.includes(id as (typeof BUILT_IN_PROVIDER_IDS)[number])) return true;
  if (id.startsWith('custom-') && customProviders?.some((cp) => cp.id === id)) return true;
  return false;
}
const VALID_DANGER_LEVELS: DangerActionLevel[] = ['critical', 'warning', 'disabled'];
const VALID_DANGER_CATEGORIES: DangerCategory[] = [
  'dataDirectory', 'sqlDestructive', 'diskFormat',
  'fileDestructive', 'gitDangerous', 'npmPublish', 'processKill',
];

/**
 * GET /api/settings
 * 返回设置（API Key 脱敏）。
 */
export async function GET() {
  const settings = await getSettings();

  const maskKey = (key: string) => key.length > 4 ? '••••••••' + key.slice(-4) : '••••';

  const masked: AppSettings = {
    ...settings,
    claude: { ...settings.claude },
  };
  if (masked.claude.apiKey) {
    masked.claude.apiKey = maskKey(masked.claude.apiKey);
  }
  // 脱敏 per-provider API Keys
  if (masked.claude.providerApiKeys) {
    const maskedKeys: Partial<Record<ProviderId, string>> = {};
    for (const [pid, key] of Object.entries(masked.claude.providerApiKeys)) {
      if (key) maskedKeys[pid as ProviderId] = maskKey(key);
    }
    masked.claude.providerApiKeys = maskedKeys;
  }

  // 脱敏 providerCredentials 中的 API Key
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

  // 脱敏自定义供应商的 apiKey
  if (masked.claude.customProviders) {
    masked.claude.customProviders = masked.claude.customProviders.map((cp) =>
      cp.apiKey ? { ...cp, apiKey: maskKey(cp.apiKey) } : cp,
    );
  }

  return NextResponse.json(masked);
}

/**
 * POST /api/settings
 * 保存设置。接收部分更新。
 *
 * apiKey 特殊处理：
 * - 以 •• 开头 → 保留原值（掩码回传）
 * - 空字符串 → 清除
 * - 其他 → 保存新值
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const current = await getSettings();

  if (body.claude?.authMode !== undefined && !VALID_AUTH_MODES.includes(body.claude.authMode)) {
    return NextResponse.json({ error: 'Invalid authMode' }, { status: 400 });
  }
  if (body.claude?.provider !== undefined && !isValidProvider(body.claude.provider, current.claude.customProviders)) {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
  }
  // model: 自由字符串，仅验证类型和长度
  if (body.claude?.model !== undefined) {
    if (typeof body.claude.model !== 'string' || body.claude.model.length > 200) {
      return NextResponse.json({ error: 'Invalid model' }, { status: 400 });
    }
  }
  if (body.claude?.apiKey !== undefined && typeof body.claude.apiKey !== 'string') {
    return NextResponse.json({ error: 'apiKey must be a string' }, { status: 400 });
  }
  if (body.claude?.apiKey?.length > 500) {
    return NextResponse.json({ error: 'apiKey too long' }, { status: 400 });
  }
  if (body.claude?.baseUrl !== undefined && typeof body.claude.baseUrl !== 'string') {
    return NextResponse.json({ error: 'baseUrl must be a string' }, { status: 400 });
  }
  if (body.claude?.effortLevel !== undefined && !VALID_EFFORT_LEVELS.includes(body.claude.effortLevel)) {
    return NextResponse.json({ error: 'Invalid effortLevel' }, { status: 400 });
  }
  if (body.claude?.maxTurns !== undefined) {
    const mt = Number(body.claude.maxTurns);
    if (!Number.isFinite(mt) || mt < 0 || mt > 1000) {
      return NextResponse.json({ error: 'maxTurns must be 0-1000' }, { status: 400 });
    }
  }
  if (body.claude?.openaiReasoningEffort !== undefined
    && !VALID_OPENAI_EFFORTS.includes(body.claude.openaiReasoningEffort)) {
    return NextResponse.json({ error: 'Invalid openaiReasoningEffort' }, { status: 400 });
  }
  if (body.claude?.openaiFastMode !== undefined && normalizeOpenAIFastMode(body.claude.openaiFastMode) === undefined) {
    return NextResponse.json({ error: 'Invalid openaiFastMode' }, { status: 400 });
  }
  // providerApiKeys: Record<ProviderId, string>
  if (body.claude?.providerApiKeys !== undefined) {
    if (typeof body.claude.providerApiKeys !== 'object' || body.claude.providerApiKeys === null) {
      return NextResponse.json({ error: 'providerApiKeys must be an object' }, { status: 400 });
    }
    for (const [pid, val] of Object.entries(body.claude.providerApiKeys)) {
      if (!isValidProvider(pid, current.claude.customProviders)) {
        return NextResponse.json({ error: `Invalid provider in providerApiKeys: ${pid}` }, { status: 400 });
      }
      if (val !== null && val !== '' && typeof val !== 'string') {
        return NextResponse.json({ error: 'providerApiKeys values must be strings' }, { status: 400 });
      }
    }
  }
  // providerModels: Record<ProviderId, string>
  if (body.claude?.providerModels !== undefined) {
    if (typeof body.claude.providerModels !== 'object' || body.claude.providerModels === null) {
      return NextResponse.json({ error: 'providerModels must be an object' }, { status: 400 });
    }
  }
  // providerModelLibrary: Record<ProviderId, string[]>
  if (body.claude?.providerModelLibrary !== undefined) {
    if (typeof body.claude.providerModelLibrary !== 'object' || body.claude.providerModelLibrary === null) {
      return NextResponse.json({ error: 'providerModelLibrary must be an object' }, { status: 400 });
    }
    for (const arr of Object.values(body.claude.providerModelLibrary)) {
      if (!Array.isArray(arr) || (arr as unknown[]).length > 200) {
        return NextResponse.json({ error: 'providerModelLibrary values must be arrays (max 200)' }, { status: 400 });
      }
    }
  }
  // providerBaseUrls: Record<ProviderId, string>
  if (body.claude?.providerBaseUrls !== undefined) {
    if (typeof body.claude.providerBaseUrls !== 'object' || body.claude.providerBaseUrls === null) {
      return NextResponse.json({ error: 'providerBaseUrls must be an object' }, { status: 400 });
    }
    for (const [pid, val] of Object.entries(body.claude.providerBaseUrls)) {
      if (!isValidProvider(pid, current.claude.customProviders)) {
        return NextResponse.json({ error: `Invalid provider in providerBaseUrls: ${pid}` }, { status: 400 });
      }
      if (val !== null && val !== '' && typeof val !== 'string') {
        return NextResponse.json({ error: 'providerBaseUrls values must be strings' }, { status: 400 });
      }
      if (typeof val === 'string' && val.length > 500) {
        return NextResponse.json({ error: 'providerBaseUrls value too long' }, { status: 400 });
      }
    }
  }

  // general 字段验证
  if (body.general?.telemetry !== undefined && typeof body.general.telemetry !== 'boolean') {
    return NextResponse.json({ error: 'telemetry must be a boolean' }, { status: 400 });
  }

  // dangerDetector 字段验证
  if (body.dangerDetector !== undefined) {
    if (typeof body.dangerDetector !== 'object' || body.dangerDetector === null) {
      return NextResponse.json({ error: 'dangerDetector must be an object' }, { status: 400 });
    }
    for (const [cat, level] of Object.entries(body.dangerDetector)) {
      if (!VALID_DANGER_CATEGORIES.includes(cat as DangerCategory)) {
        return NextResponse.json({ error: `Invalid danger category: ${cat}` }, { status: 400 });
      }
      if (!VALID_DANGER_LEVELS.includes(level as DangerActionLevel)) {
        return NextResponse.json({ error: `Invalid danger level for ${cat}: ${level}` }, { status: 400 });
      }
    }
  }

  // customProviders 字段验证
  if (body.claude?.customProviders !== undefined) {
    if (!Array.isArray(body.claude.customProviders)) {
      return NextResponse.json({ error: 'customProviders must be an array' }, { status: 400 });
    }
    if (body.claude.customProviders.length > 50) {
      return NextResponse.json({ error: 'customProviders max 50' }, { status: 400 });
    }
    const seen = new Set<string>();
    for (const cp of body.claude.customProviders as CustomProviderConfig[]) {
      if (!cp || typeof cp !== 'object') {
        return NextResponse.json({ error: 'Each customProvider must be an object' }, { status: 400 });
      }
      if (!cp.id || !cp.id.startsWith('custom-')) {
        return NextResponse.json({ error: 'customProvider.id must start with custom-' }, { status: 400 });
      }
      if (seen.has(cp.id)) {
        return NextResponse.json({ error: `Duplicate customProvider id: ${cp.id}` }, { status: 400 });
      }
      seen.add(cp.id);
      if (!cp.name || typeof cp.name !== 'string' || cp.name.length > 100) {
        return NextResponse.json({ error: 'customProvider.name required, max 100 chars' }, { status: 400 });
      }
      if (!['anthropic', 'openai'].includes(cp.apiProtocol)) {
        return NextResponse.json({ error: 'customProvider.apiProtocol must be anthropic or openai' }, { status: 400 });
      }
      if (!cp.baseUrl || typeof cp.baseUrl !== 'string' || cp.baseUrl.length > 500) {
        return NextResponse.json({ error: 'customProvider.baseUrl required, max 500 chars' }, { status: 400 });
      }
      if (!['AUTH_TOKEN', 'API_KEY'].includes(cp.authMethod)) {
        return NextResponse.json({ error: 'customProvider.authMethod must be AUTH_TOKEN or API_KEY' }, { status: 400 });
      }
      if (!Array.isArray(cp.modelIds) || cp.modelIds.length === 0 || cp.modelIds.length > 50) {
        return NextResponse.json({ error: 'customProvider.modelIds must be non-empty array, max 50' }, { status: 400 });
      }
      for (const mid of cp.modelIds) {
        if (typeof mid !== 'string' || mid.length > 200) {
          return NextResponse.json({ error: 'customProvider.modelIds entries must be strings, max 200' }, { status: 400 });
        }
      }
    }
  }

  // titleGeneration 字段验证
  if (body.titleGeneration !== undefined) {
    if (typeof body.titleGeneration !== 'object' || body.titleGeneration === null) {
      return NextResponse.json({ error: 'titleGeneration must be an object' }, { status: 400 });
    }
    if (body.titleGeneration.enabled !== undefined && typeof body.titleGeneration.enabled !== 'boolean') {
      return NextResponse.json({ error: 'titleGeneration.enabled must be a boolean' }, { status: 400 });
    }
    if (body.titleGeneration.chain !== undefined) {
      if (!Array.isArray(body.titleGeneration.chain) || body.titleGeneration.chain.length > 10) {
        return NextResponse.json({ error: 'titleGeneration.chain must be an array (max 10)' }, { status: 400 });
      }
      for (const entry of body.titleGeneration.chain) {
        if (!entry.provider || !entry.model) {
          return NextResponse.json({ error: 'Each chain entry must have provider and model' }, { status: 400 });
        }
        if (!isValidProvider(entry.provider, current.claude.customProviders)) {
          return NextResponse.json({ error: `Invalid provider in chain: ${entry.provider}` }, { status: 400 });
        }
      }
    }
  }

  // notifications 字段验证
  if (body.notifications !== undefined) {
    if (typeof body.notifications !== 'object' || body.notifications === null) {
      return NextResponse.json({ error: 'notifications must be an object' }, { status: 400 });
    }
    const n = body.notifications as Record<string, unknown>;
    if (n.enabled !== undefined && typeof n.enabled !== 'boolean') {
      return NextResponse.json({ error: 'notifications.enabled must be a boolean' }, { status: 400 });
    }
    if (n.soundEnabled !== undefined && typeof n.soundEnabled !== 'boolean') {
      return NextResponse.json({ error: 'notifications.soundEnabled must be a boolean' }, { status: 400 });
    }
    if (n.soundVolume !== undefined) {
      const v = Number(n.soundVolume);
      if (!Number.isFinite(v) || v < 0 || v > 1) {
        return NextResponse.json({ error: 'notifications.soundVolume must be 0-1' }, { status: 400 });
      }
    }
    if (n.onlyWhenUnfocused !== undefined && typeof n.onlyWhenUnfocused !== 'boolean') {
      return NextResponse.json({ error: 'notifications.onlyWhenUnfocused must be a boolean' }, { status: 400 });
    }
    if (n.titleTemplate !== undefined) {
      if (typeof n.titleTemplate !== 'string' || n.titleTemplate.trim().length === 0 || n.titleTemplate.length > 200) {
        return NextResponse.json({ error: 'notifications.titleTemplate must be a non-empty string up to 200 chars' }, { status: 400 });
      }
    }
    if (n.bodyTemplate !== undefined) {
      if (typeof n.bodyTemplate !== 'string' || n.bodyTemplate.trim().length === 0 || n.bodyTemplate.length > 500) {
        return NextResponse.json({ error: 'notifications.bodyTemplate must be a non-empty string up to 500 chars' }, { status: 400 });
      }
    }
    if (n.minDurationMs !== undefined) {
      const v = Number(n.minDurationMs);
      if (!Number.isInteger(v) || v < 0 || v > 86_400_000) {
        return NextResponse.json({ error: 'notifications.minDurationMs must be an integer between 0 and 86400000' }, { status: 400 });
      }
    }
    if (n.dedupeWindowMs !== undefined) {
      const v = Number(n.dedupeWindowMs);
      if (!Number.isInteger(v) || v < 0 || v > 600_000) {
        return NextResponse.json({ error: 'notifications.dedupeWindowMs must be an integer between 0 and 600000' }, { status: 400 });
      }
    }
    if (n.clickAction !== undefined && !VALID_NOTIFICATION_CLICK_ACTIONS.includes(n.clickAction as NotificationClickAction)) {
      return NextResponse.json({ error: 'notifications.clickAction is invalid' }, { status: 400 });
    }
    if (n.requireInteraction !== undefined && typeof n.requireInteraction !== 'boolean') {
      return NextResponse.json({ error: 'notifications.requireInteraction must be a boolean' }, { status: 400 });
    }
    if (n.soundSource !== undefined && !isValidSoundSource(n.soundSource)) {
      return NextResponse.json({ error: 'notifications.soundSource must be builtin or custom' }, { status: 400 });
    }
    if (n.builtinSound !== undefined && !isValidBuiltInSoundId(n.builtinSound)) {
      return NextResponse.json({ error: 'notifications.builtinSound is invalid' }, { status: 400 });
    }
    if (n.customSoundDataUrl !== undefined) {
      if (n.customSoundDataUrl !== null && typeof n.customSoundDataUrl !== 'string') {
        return NextResponse.json({ error: 'notifications.customSoundDataUrl must be a string' }, { status: 400 });
      }
      if (
        typeof n.customSoundDataUrl === 'string'
        && (
          !n.customSoundDataUrl.startsWith('data:audio/')
          || n.customSoundDataUrl.length > MAX_CUSTOM_SOUND_DATA_URL_LENGTH
        )
      ) {
        return NextResponse.json({ error: 'notifications.customSoundDataUrl must be a short audio data URL' }, { status: 400 });
      }
    }
    if (n.customSoundName !== undefined) {
      if (n.customSoundName !== null && typeof n.customSoundName !== 'string') {
        return NextResponse.json({ error: 'notifications.customSoundName must be a string' }, { status: 400 });
      }
      if (typeof n.customSoundName === 'string' && n.customSoundName.length > 120) {
        return NextResponse.json({ error: 'notifications.customSoundName too long' }, { status: 400 });
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

  // authMode 变更时同步到 providerCredentials
  if (body.claude?.authMode !== undefined) {
    const targetProvider = (body.claude?.provider ?? updated.claude.provider ?? 'anthropic') as ProviderId;
    if (!updated.claude.providerCredentials) updated.claude.providerCredentials = { ...current.claude.providerCredentials };
    const existing = updated.claude.providerCredentials?.[targetProvider] ?? { authMode: 'api_key' as const };
    updated.claude.providerCredentials[targetProvider] = { ...existing, authMode: body.claude.authMode };
  }

  // API Key 特殊处理（legacy flat key）
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

  // Per-provider API Keys 处理
  if (body.claude?.providerApiKeys !== undefined) {
    const merged = { ...current.claude.providerApiKeys };
    for (const [pid, val] of Object.entries(body.claude.providerApiKeys as Record<string, string | null>)) {
      if (val === null || val === '') {
        delete merged[pid as ProviderId];
      } else if (typeof val === 'string' && val.startsWith('••')) {
        // 掩码回传，保留原值
      } else {
        merged[pid as ProviderId] = val as string;
      }
    }
    updated.claude.providerApiKeys = Object.keys(merged).length > 0 ? merged : undefined;

    // 同步 legacy flat apiKey：当 anthropic 的 scoped key 更新时，同步到 flat field
    if (merged.anthropic) {
      updated.claude.apiKey = merged.anthropic;
    }

    // 同步到 providerCredentials（新统一存储）
    if (!updated.claude.providerCredentials) updated.claude.providerCredentials = { ...current.claude.providerCredentials };
    for (const [pid, val] of Object.entries(body.claude.providerApiKeys as Record<string, string | null>)) {
      const p = pid as ProviderId;
      if (val === null || val === '') {
        // 清除 API Key，但保留其他凭据字段（如 oauth）
        if (updated.claude.providerCredentials?.[p]) {
          updated.claude.providerCredentials[p] = { ...updated.claude.providerCredentials[p]!, apiKey: undefined };
        }
      } else if (typeof val === 'string' && val.startsWith('••')) {
        // 掩码回传，不动 providerCredentials
      } else {
        const existing = updated.claude.providerCredentials?.[p] ?? { authMode: 'api_key' as const };
        updated.claude.providerCredentials[p] = { ...existing, apiKey: val as string };
      }
    }
  }

  // Per-provider models
  if (body.claude?.providerModels !== undefined) {
    updated.claude.providerModels = {
      ...current.claude.providerModels,
      ...body.claude.providerModels,
    };
  }

  // Per-provider model library
  if (body.claude?.providerModelLibrary !== undefined) {
    updated.claude.providerModelLibrary = {
      ...current.claude.providerModelLibrary,
      ...body.claude.providerModelLibrary,
    };
  }

  // Per-provider base URLs (e.g. Kimi 探测后持久化)
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

  // OpenAI reasoning effort
  if (body.claude?.openaiReasoningEffort !== undefined) {
    updated.claude.openaiReasoningEffort = body.claude.openaiReasoningEffort;
  }
  if (body.claude?.openaiFastMode !== undefined) {
    updated.claude.openaiFastMode = body.claude.openaiFastMode;
  }

  // Custom providers（apiKey 掩码回传时保留原值）
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
  return NextResponse.json({ success: true });
}
