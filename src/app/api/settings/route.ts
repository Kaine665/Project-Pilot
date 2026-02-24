import { NextRequest, NextResponse } from 'next/server';
import { getSettings, saveSettings } from '@/lib/settings-manager';
import { PROVIDER_REGISTRY } from '@/lib/provider-registry';
import type { ClaudeAuthMode, ProviderId, EffortLevel, AppSettings } from '@/types';

const VALID_AUTH_MODES: ClaudeAuthMode[] = ['api_key', 'oauth'];
const VALID_EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high'];
const VALID_PROVIDERS: ProviderId[] = PROVIDER_REGISTRY.map((p) => p.id);

/**
 * GET /api/settings
 * 返回设置（API Key 脱敏）。
 */
export async function GET() {
  const settings = await getSettings();

  const masked: AppSettings = {
    ...settings,
    claude: { ...settings.claude },
  };
  if (masked.claude.apiKey) {
    const key = masked.claude.apiKey;
    masked.claude.apiKey = key.length > 4 ? '••••••••' + key.slice(-4) : '••••';
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

  // API Key 特殊处理
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

  await saveSettings(updated);
  return NextResponse.json({ success: true });
}
