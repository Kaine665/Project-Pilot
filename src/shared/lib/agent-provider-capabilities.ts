import type { ProviderId } from '@/types';

/**
 * Agent Chat 是否具备本地工具（Read/Bash 等）。
 * 现策略：OpenAI → Codex；其余内置与 Anthropic 协议 custom-* → Claude Agent SDK。
 * 仅「自定义且 OpenAI 协议」走裸 API；UI 横幅等若需区分，应结合 settings 中的 customProviders，而非仅靠 provider id。
 */
export function providerSupportsLocalAgentTools(_provider: ProviderId): boolean {
  return true;
}

/**
 * 与会话 prompt / Runner 解析一致：会话配置 → Agent 默认 → anthropic
 */
export function resolveEffectiveAgentChatProvider(
  sessionConfig: { provider?: ProviderId } | undefined,
  agent: { defaultProvider?: ProviderId },
): ProviderId {
  return sessionConfig?.provider ?? agent.defaultProvider ?? 'anthropic';
}
