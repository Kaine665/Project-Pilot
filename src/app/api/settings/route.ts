import { NextRequest, NextResponse } from 'next/server';
import { getSettings, saveSettings } from '@/lib/settings-manager';
import { PROVIDER_REGISTRY } from '@/lib/provider-registry';
import type { ClaudeAuthMode, ProviderId, EffortLevel, OpenAIReasoningEffort, AppSettings } from '@/types';

const VALID_AUTH_MODES: ClaudeAuthMode[] = ['api_key', 'oauth'];
const VALID_EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high'];
const VALID_OPENAI_REASONING_EFFORTS: OpenAIReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
const VALID_PROVIDERS: ProviderId[] = PROVIDER_REGISTRY.map((p) => p.id);
const MASK_PREFIX = '••';

type ProviderApiKeyMap = Partial<Record<ProviderId, string>>;
type ProviderModelMap = Partial<Record<ProviderId, string>>;
type ProviderModelLibraryMap = Partial<Record<ProviderId, string[]>>;

function maskKey(value: string): string {
  return value.length > 4 ? `••••••••${value.slice(-4)}` : '••••';
}

function isMasked(value: string): boolean {
  return value.startsWith(MASK_PREFIX);
}

function normalizeProviderApiKeys(settings: AppSettings): ProviderApiKeyMap {
  const normalized: ProviderApiKeyMap = { ...(settings.claude.providerApiKeys || {}) };
  if (!normalized[settings.claude.provider] && settings.claude.apiKey) {
    normalized[settings.claude.provider] = settings.claude.apiKey;
  }
  return normalized;
}

function normalizeProviderModels(settings: AppSettings): ProviderModelMap {
  const normalized: ProviderModelMap = { ...(settings.claude.providerModels || {}) };
  if (!normalized[settings.claude.provider] && settings.claude.model) {
    normalized[settings.claude.provider] = settings.claude.model;
  }
  return normalized;
}

function normalizeProviderModelLibrary(settings: AppSettings): ProviderModelLibraryMap {
  const library = settings.claude.providerModelLibrary;
  if (!library || typeof library !== 'object') return {};
  const normalized: ProviderModelLibraryMap = {};
  for (const provider of VALID_PROVIDERS) {
    const items = library[provider];
    if (!Array.isArray(items)) continue;
    const clean = Array.from(
      new Set(
        items
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ).slice(0, 200);
    if (clean.length > 0) normalized[provider] = clean;
  }
  return normalized;
}

function maskProviderApiKeys(map: ProviderApiKeyMap): ProviderApiKeyMap {
  const masked: ProviderApiKeyMap = {};
  for (const provider of VALID_PROVIDERS) {
    const key = map[provider];
    if (key) masked[provider] = maskKey(key);
  }
  return masked;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * GET /api/settings
 * 返回设置（API Key 脱敏）。
 */
export async function GET() {
  const settings = await getSettings();
  const providerApiKeys = normalizeProviderApiKeys(settings);
  const providerModels = normalizeProviderModels(settings);
  const providerModelLibrary = normalizeProviderModelLibrary(settings);
  const maskedProviderApiKeys = maskProviderApiKeys(providerApiKeys);
  const currentProviderKey = providerApiKeys[settings.claude.provider];

  const masked: AppSettings = {
    ...settings,
    claude: {
      ...settings.claude,
      providerApiKeys: Object.keys(maskedProviderApiKeys).length > 0 ? maskedProviderApiKeys : undefined,
      providerModels: Object.keys(providerModels).length > 0 ? providerModels : undefined,
      providerModelLibrary: Object.keys(providerModelLibrary).length > 0 ? providerModelLibrary : undefined,
      apiKey: currentProviderKey ? maskKey(currentProviderKey) : undefined,
    },
  };

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
  if (body.claude?.provider !== undefined && !VALID_PROVIDERS.includes(body.claude.provider)) {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
  }
  // model: 自由字符串，仅验证类型和长度
  if (body.claude?.model !== undefined) {
    if (typeof body.claude.model !== 'string' || body.claude.model.length > 200) {
      return NextResponse.json({ error: 'Invalid model' }, { status: 400 });
    }
  }
  if (body.claude?.apiKey !== undefined && body.claude.apiKey !== null && typeof body.claude.apiKey !== 'string') {
    return NextResponse.json({ error: 'apiKey must be a string' }, { status: 400 });
  }
  if (typeof body.claude?.apiKey === 'string' && body.claude.apiKey.length > 500) {
    return NextResponse.json({ error: 'apiKey too long' }, { status: 400 });
  }
  if (body.claude?.providerApiKeys !== undefined) {
    if (!isRecord(body.claude.providerApiKeys)) {
      return NextResponse.json({ error: 'providerApiKeys must be an object' }, { status: 400 });
    }
    for (const [provider, value] of Object.entries(body.claude.providerApiKeys)) {
      if (!VALID_PROVIDERS.includes(provider as ProviderId)) {
        return NextResponse.json({ error: `Invalid provider in providerApiKeys: ${provider}` }, { status: 400 });
      }
      if (value !== null && typeof value !== 'string') {
        return NextResponse.json({ error: `providerApiKeys.${provider} must be a string` }, { status: 400 });
      }
      if (typeof value === 'string' && value.length > 500) {
        return NextResponse.json({ error: `providerApiKeys.${provider} too long` }, { status: 400 });
      }
    }
  }
  if (body.claude?.providerModels !== undefined) {
    if (!isRecord(body.claude.providerModels)) {
      return NextResponse.json({ error: 'providerModels must be an object' }, { status: 400 });
    }
    for (const [provider, value] of Object.entries(body.claude.providerModels)) {
      if (!VALID_PROVIDERS.includes(provider as ProviderId)) {
        return NextResponse.json({ error: `Invalid provider in providerModels: ${provider}` }, { status: 400 });
      }
      if (value !== null && typeof value !== 'string') {
        return NextResponse.json({ error: `providerModels.${provider} must be a string` }, { status: 400 });
      }
      if (typeof value === 'string' && value.length > 200) {
        return NextResponse.json({ error: `providerModels.${provider} too long` }, { status: 400 });
      }
    }
  }
  if (body.claude?.providerModelLibrary !== undefined) {
    if (!isRecord(body.claude.providerModelLibrary)) {
      return NextResponse.json({ error: 'providerModelLibrary must be an object' }, { status: 400 });
    }
    for (const [provider, value] of Object.entries(body.claude.providerModelLibrary)) {
      if (!VALID_PROVIDERS.includes(provider as ProviderId)) {
        return NextResponse.json({ error: `Invalid provider in providerModelLibrary: ${provider}` }, { status: 400 });
      }
      if (!Array.isArray(value)) {
        return NextResponse.json({ error: `providerModelLibrary.${provider} must be a string[]` }, { status: 400 });
      }
      if (value.length > 200) {
        return NextResponse.json({ error: `providerModelLibrary.${provider} too many items` }, { status: 400 });
      }
      for (const item of value) {
        if (typeof item !== 'string' || item.length > 200) {
          return NextResponse.json({ error: `providerModelLibrary.${provider} contains invalid model id` }, { status: 400 });
        }
      }
    }
  }
  if (body.claude?.baseUrl !== undefined && typeof body.claude.baseUrl !== 'string') {
    return NextResponse.json({ error: 'baseUrl must be a string' }, { status: 400 });
  }
  if (body.claude?.effortLevel !== undefined && !VALID_EFFORT_LEVELS.includes(body.claude.effortLevel)) {
    return NextResponse.json({ error: 'Invalid effortLevel' }, { status: 400 });
  }
  if (
    body.claude?.openaiReasoningEffort !== undefined
    && !VALID_OPENAI_REASONING_EFFORTS.includes(body.claude.openaiReasoningEffort)
  ) {
    return NextResponse.json({ error: 'Invalid openaiReasoningEffort' }, { status: 400 });
  }
  if (body.claude?.maxTurns !== undefined) {
    const mt = Number(body.claude.maxTurns);
    if (!Number.isFinite(mt) || mt < 0 || mt > 1000) {
      return NextResponse.json({ error: 'maxTurns must be 0-1000' }, { status: 400 });
    }
  }

  // general 字段验证
  if (body.general?.telemetry !== undefined && typeof body.general.telemetry !== 'boolean') {
    return NextResponse.json({ error: 'telemetry must be a boolean' }, { status: 400 });
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
      ...(body.claude?.openaiReasoningEffort !== undefined && { openaiReasoningEffort: body.claude.openaiReasoningEffort }),
      ...(body.claude?.maxTurns !== undefined && { maxTurns: Number(body.claude.maxTurns) || 0 }),
    },
    ...(body.general !== undefined && {
      general: {
        ...current.general,
        ...(body.general?.telemetry !== undefined && { telemetry: body.general.telemetry }),
      },
    }),
    version: current.version,
  };

  const currentProviderApiKeys = normalizeProviderApiKeys(current);
  const nextProviderApiKeys: ProviderApiKeyMap = { ...currentProviderApiKeys };
  const currentProviderModels = normalizeProviderModels(current);
  const nextProviderModels: ProviderModelMap = { ...currentProviderModels };
  const currentProviderModelLibrary = normalizeProviderModelLibrary(current);
  const nextProviderModelLibrary: ProviderModelLibraryMap = { ...currentProviderModelLibrary };

  if (body.claude?.providerApiKeys !== undefined && isRecord(body.claude.providerApiKeys)) {
    for (const [provider, value] of Object.entries(body.claude.providerApiKeys)) {
      const providerId = provider as ProviderId;
      const incoming = value as string | null;

      if (incoming === null || incoming === '') {
        delete nextProviderApiKeys[providerId];
      } else if (isMasked(incoming)) {
        if (!currentProviderApiKeys[providerId]) {
          delete nextProviderApiKeys[providerId];
        }
      } else {
        nextProviderApiKeys[providerId] = incoming;
      }
    }
  }

  if (body.claude?.providerModels !== undefined && isRecord(body.claude.providerModels)) {
    for (const [provider, value] of Object.entries(body.claude.providerModels)) {
      const providerId = provider as ProviderId;
      const incoming = value as string | null;
      const trimmed = typeof incoming === 'string' ? incoming.trim() : incoming;

      if (trimmed === null || trimmed === '') {
        delete nextProviderModels[providerId];
      } else {
        nextProviderModels[providerId] = trimmed;
      }
    }
  }

  if (body.claude?.providerModelLibrary !== undefined && isRecord(body.claude.providerModelLibrary)) {
    for (const [provider, value] of Object.entries(body.claude.providerModelLibrary)) {
      const providerId = provider as ProviderId;
      const incoming = value as unknown;
      if (!Array.isArray(incoming)) {
        continue;
      }
      const clean = Array.from(
        new Set(
          incoming
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ).slice(0, 200);

      if (clean.length === 0) {
        delete nextProviderModelLibrary[providerId];
      } else {
        nextProviderModelLibrary[providerId] = clean;
      }
    }
  }

  // API Key 特殊处理
  if (body.claude?.apiKey !== undefined) {
    const newKey = body.claude.apiKey as string | null;
    const effectiveProvider = updated.claude.provider;

    if (newKey === '' || newKey === null) {
      delete nextProviderApiKeys[effectiveProvider];
    } else if (isMasked(newKey)) {
      if (!currentProviderApiKeys[effectiveProvider]) {
        delete nextProviderApiKeys[effectiveProvider];
      }
    } else {
      nextProviderApiKeys[effectiveProvider] = newKey;
    }
  }

  if (body.claude?.model !== undefined) {
    const effectiveProvider = updated.claude.provider;
    const modelValue = typeof body.claude.model === 'string' ? body.claude.model.trim() : '';
    if (!modelValue) {
      delete nextProviderModels[effectiveProvider];
    } else {
      nextProviderModels[effectiveProvider] = modelValue;
    }
  }

  updated.claude.providerApiKeys = Object.keys(nextProviderApiKeys).length > 0 ? nextProviderApiKeys : undefined;
  updated.claude.apiKey = nextProviderApiKeys[updated.claude.provider];
  updated.claude.providerModels = Object.keys(nextProviderModels).length > 0 ? nextProviderModels : undefined;
  updated.claude.providerModelLibrary = Object.keys(nextProviderModelLibrary).length > 0 ? nextProviderModelLibrary : undefined;
  updated.claude.model =
    nextProviderModels[updated.claude.provider]
    || updated.claude.model
    || current.claude.model
    || 'claude-sonnet-4-5-20250929';

  await saveSettings(updated);
  return NextResponse.json({ success: true });
}
