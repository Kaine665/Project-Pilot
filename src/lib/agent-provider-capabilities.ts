import type { AgentCapabilities, ProviderId } from '@/types';

/**
 * 纠正部分模型（尤其第三方 Anthropic 兼容端）谎称「纯文本 API、无本地工具」的幻觉。
 * 在 Agent Chat 成功启动时，底层恒为 Claude Agent SDK 或 Codex SDK（custom+OpenAI 协议已在入口拦截）。
 */
export function appendLocalAgentSdkToolingNotice(prompt: string, caps: AgentCapabilities): string {
  const hasLocalTools = caps.bash || caps.fileAccess || caps.web || caps.subAgent;
  if (!hasLocalTools) return prompt;

  const notice = `---
## 运行时环境说明（系统自动附加）
ProjectPilot 已通过 **Claude Agent SDK**（Anthropic 兼容线路，含 DeepSeek、Kimi 等）或 **OpenAI Codex SDK**（内置 OpenAI 线路）在本机启动 Agent 运行时；已按当前 Agent 能力配置挂载可用工具（如 Read、Bash、Glob、Grep、Write 等，以实际调用为准）。
- **禁止**向用户声称「当前是纯文本 Messages API」「没有文件读取工具」「无法执行终端命令」等概括性推脱——应优先用工具获取真实输出。
- 若某次工具调用失败、被用户拒绝或上游 API 报错，可仅针对该次失败说明原因，不要断言「整条线路无工具」。`;

  return `${prompt}\n\n${notice}\n`;
}

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
