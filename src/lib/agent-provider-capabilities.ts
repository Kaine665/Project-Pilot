import type { ProviderId } from '@/types';

/** 使用 Claude Agent SDK 或 Codex、具备真实本地工具的渠道 */
const LOCAL_AGENT_TOOLS_PROVIDERS = new Set<ProviderId>(['anthropic', 'openai']);

/**
 * Agent 对话是否由带本地工具的执行层驱动（Claude Agent SDK / Codex）。
 * 其余渠道走 SimpleAnthropicRunner，仅为 Messages API 纯文本，无 Read/Bash 等工具事件。
 */
export function providerSupportsLocalAgentTools(provider: ProviderId): boolean {
  return LOCAL_AGENT_TOOLS_PROVIDERS.has(provider);
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

const TEXT_ONLY_CHANNEL_NOTICE = `---
## 运行时渠道说明（系统自动附加）
当前会话使用的 AI 渠道为 **兼容 Anthropic 的纯文本 Messages API**，应用**未向该模型暴露** Read、Bash、Glob、Grep、Write 等本地工具接口。
- **禁止**假装已执行终端命令或已读取本机路径；**禁止**虚构命令输出或「正在执行」类话术。
- 若用户需要查看本地目录（例如 ~/.project-pilot/）或运行命令：请明确说明**当前渠道无法代为执行**，并建议改用 **内置 Anthropic** 或 **内置 OpenAI（Codex）** 渠道，或由用户自行在终端执行后粘贴输出。`;

/**
 * 对无本地工具的渠道，在发给模型的 prompt 末尾附加说明，减少「口述指令」式幻觉。
 */
export function appendTextOnlyAgentChannelNotice(prompt: string, provider: ProviderId): string {
  if (providerSupportsLocalAgentTools(provider)) return prompt;
  return `${prompt}\n\n${TEXT_ONLY_CHANNEL_NOTICE}\n`;
}
