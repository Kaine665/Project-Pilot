import type { ClaudeSettings, ProviderId } from '@/types';

/**
 * 设置页是否展示「OAuth / API Key」切换（当前仅 OpenAI Codex 可在开关开启后使用 OAuth）。
 * 独立文件避免 client 组件 import settings-manager（含 Node fs）。
 */
export function providerSupportsOAuthUi(
  claude: Pick<ClaudeSettings, 'openaiOAuthEnabled'>,
  provider: ProviderId,
  presetSupportsOAuth: boolean,
): boolean {
  if (!presetSupportsOAuth) return false;
  if (provider === 'openai') return claude.openaiOAuthEnabled === true;
  return false;
}
