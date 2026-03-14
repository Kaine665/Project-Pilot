/**
 * await-sub-agents action — AI 可以在回复中嵌入此标签，进入 awaiting 状态等待 Sub Agent 完成。
 *
 * 标签格式：
 * <await-sub-agents session-ids="sess1,sess2,sess3" />
 * 或
 * <await-sub-agents session-ids="sess1,sess2">可选说明文本</await-sub-agents>
 *
 * 处理后，当前会话进入 awaiting 状态（SDK 资源释放），Sub Agent 完成后自动唤醒。
 */

import { subAgentWatcher, WATCHER_DEFAULT_TIMEOUT_MS } from '@/lib/chat-managers/sub-agent-watcher';
import type { AgentAction, ActionContext } from './types';

// ── Parsed tag data ──

interface AwaitSubAgentsTagData {
  sessionIds: string[];
}

// ── Tag regex — matches both self-closing and content forms ──

// Self-closing: <await-sub-agents session-ids="a,b,c" />
// With body: <await-sub-agents session-ids="a,b,c">text</await-sub-agents>
const TAG_REGEX = /<await-sub-agents\s+session-ids="([^"]+)"\s*(?:\/>|>([\s\S]*?)<\/await-sub-agents>)/g;

// ── Action definition ──

export const awaitSubAgentsAction: AgentAction<AwaitSubAgentsTagData> = {
  id: 'await-sub-agents',
  resourceType: 'await-sub-agents-instructions',
  sectionTitle: 'Sub Agent 等待',
  priority: 10, // Execute early — must register watcher before finalizeRun checks the flag

  // No instructions injected into prompt — this is an internal mechanism,
  // the agent prompt (self-dev etc.) already knows to use this tag via its own docs.
  instructions: '',

  parse(text: string): AwaitSubAgentsTagData[] {
    const results: AwaitSubAgentsTagData[] = [];
    const regex = new RegExp(TAG_REGEX.source, TAG_REGEX.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      const ids = match[1]
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      if (ids.length > 0) {
        results.push({ sessionIds: ids });
      }
    }
    return results;
  },

  strip(text: string): string {
    return text
      .replace(/<await-sub-agents\s+session-ids="[^"]*"\s*\/>/g, '')
      .replace(/<await-sub-agents\s+session-ids="[^"]*"\s*>[\s\S]*?<\/await-sub-agents>/g, '')
      .trim();
  },

  async execute(data: AwaitSubAgentsTagData, ctx: ActionContext): Promise<void> {
    // Register watch entry
    subAgentWatcher.register({
      parentSessionId: ctx.sessionId,
      parentAgentId: ctx.agentId,
      parentProjectKey: ctx.projectKey,
      targetSessionIds: data.sessionIds,
      registeredAt: Date.now(),
      timeoutMs: WATCHER_DEFAULT_TIMEOUT_MS,
    });

    // Set flag on context so finalizeRun knows to enter awaiting state
    (ctx as ActionContext & { _awaitingSubAgents?: boolean })._awaitingSubAgents = true;

    console.log(
      `[await-sub-agents] Registered watcher: parent=${ctx.sessionId}, targets=[${data.sessionIds.join(',')}]`,
    );
  },
};
