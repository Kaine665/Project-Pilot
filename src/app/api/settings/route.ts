import { NextRequest, NextResponse } from 'next/server';
import { getSettings, saveSettings } from '@/lib/settings-manager';
import { PROVIDER_REGISTRY } from '@/lib/provider-registry';
import type { ClaudeAuthMode, ProviderId, EffortLevel, OpenAIReasoningEffort, AppSettings, DangerCategory, DangerActionLevel } from '@/types';
import { DEFAULT_DANGER_SETTINGS } from '@/types';

const VALID_AUTH_MODES: ClaudeAuthMode[] = ['api_key', 'oauth'];
const VALID_EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high'];
const VALID_OPENAI_EFFORTS: OpenAIReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
const VALID_PROVIDERS: ProviderId[] = PROVIDER_REGISTRY.map((p) => p.id);
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
  // providerApiKeys: Record<ProviderId, string>
  if (body.claude?.providerApiKeys !== undefined) {
    if (typeof body.claude.providerApiKeys !== 'object' || body.claude.providerApiKeys === null) {
      return NextResponse.json({ error: 'providerApiKeys must be an object' }, { status: 400 });
    }
    for (const [pid, val] of Object.entries(body.claude.providerApiKeys)) {
      if (!VALID_PROVIDERS.includes(pid as ProviderId)) {
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
      if (!VALID_PROVIDERS.includes(pid as ProviderId)) {
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
    version: current.version,
  };

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

  await saveSettings(updated);
  return NextResponse.json({ success: true });
}
