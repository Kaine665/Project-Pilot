/**
 * GET /api/settings/health
 *
 * 系统健康检查：检测 Claude CLI 是否可用、API Key 是否配置。
 * 供前端在首次加载时调用，展示引导提示。
 */

import { NextResponse } from 'next/server';
import { checkClaudeCliHealth } from '@/lib/claude-cli';
import { getSettings, getCredential, getEffectiveAuthMode } from '@/lib/settings-manager';

export async function GET() {
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

  return NextResponse.json({
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
}
