import type { AgentCapabilities } from '@/types';

/**
 * 历史：曾在用户侧资源提示末尾追加工作区说明。
 * Phase 1 起平台事实与策略由 `buildSystemLevelPrompt` 注入 SDK systemPrompt；此处保持恒等。
 */
export function appendAgentWorkspacePathNotice(
  prompt: string,
  _agentId: string,
  _caps: AgentCapabilities,
): string {
  return prompt;
}
