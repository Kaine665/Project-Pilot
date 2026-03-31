/**
 * Codex SDK 事件适配器 — 将 @openai/codex-sdk 的 ThreadEvent 转换为 AgentEvent。
 *
 * 与 CodexStreamParser 逻辑一致，但直接消费 SDK 的 typed events。
 * 使用有状态类以正确拼接 reasoning 项的流式 text。
 */

import type { ThreadEvent, ThreadItem } from '@openai/codex-sdk';
import type { AgentEvent } from '@/types';

/**
 * 将单个 ThreadEvent 转换为零或多个 AgentEvent（无状态；不适用于 reasoning 流式拼接）。
 * @deprecated 新代码请使用 {@link CodexSdkEventAdapter}（Runner 内已使用）。
 */
export function adaptCodexEvent(event: ThreadEvent): { events: AgentEvent[]; sessionId?: string } {
  return new CodexSdkEventAdapter().adapt(event);
}

export class CodexSdkEventAdapter {
  /** reasoning 项 id → 已发出的完整前缀长度，用于计算增量 */
  private reasoningPrev = new Map<string, string>();

  adapt(event: ThreadEvent): { events: AgentEvent[]; sessionId?: string } {
    const events: AgentEvent[] = [];
    let sessionId: string | undefined;

    switch (event.type) {
      case 'thread.started':
        this.reasoningPrev.clear();
        sessionId = event.thread_id;
        break;

      case 'item.started':
        events.push(...this.adaptItemStarted(event.item));
        break;

      case 'item.updated':
        events.push(...this.adaptItemUpdated(event.item));
        break;

      case 'item.completed':
        events.push(...this.adaptItemCompleted(event.item));
        break;

      case 'turn.failed':
        events.push({
          type: 'error',
          message: event.error?.message ?? 'Codex turn failed',
        });
        break;

      case 'error':
        events.push({
          type: 'error',
          message: event.message ?? 'Codex error',
        });
        break;

      case 'turn.completed':
        if (event.usage && (event.usage.input_tokens > 0 || event.usage.output_tokens > 0)) {
          events.push({
            type: 'token_usage',
            inputTokens: event.usage.input_tokens,
            outputTokens: event.usage.output_tokens,
          });
        }
        break;

      default:
        break;
    }

    return { events, sessionId };
  }

  private adaptItemStarted(item: ThreadItem): AgentEvent[] {
    const id = item.id ?? `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (item.type === 'command_execution') {
      return [{
        type: 'tool_use_start',
        id,
        toolName: 'Bash',
        input: item.command,
      }];
    }

    if (item.type === 'file_change') {
      return [{
        type: 'tool_use_start',
        id,
        toolName: 'Edit',
        input: JSON.stringify({ changes: item.changes }),
      }];
    }

    if (item.type === 'mcp_tool_call') {
      return [{
        type: 'tool_use_start',
        id,
        toolName: `mcp__${item.server}__${item.tool}`,
        input: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}),
      }];
    }

    return [];
  }

  private adaptItemUpdated(item: ThreadItem): AgentEvent[] {
    if (item.type === 'agent_message' && item.text) {
      return [{ type: 'text_delta', text: item.text }];
    }

    if (item.type === 'reasoning' && typeof item.text === 'string') {
      return this.reasoningDeltas(item.id, item.text);
    }

    return [];
  }

  private adaptItemCompleted(item: ThreadItem): AgentEvent[] {
    const id = item.id ?? '';

    if (item.type === 'command_execution') {
      const output = item.aggregated_output ?? '';
      const status = (item.exit_code === 0 ? 'completed' : 'failed') as 'completed' | 'failed';
      return [{
        type: 'tool_use_end',
        id,
        output,
        status,
      }];
    }

    if (item.type === 'agent_message' && item.text) {
      return [{
        type: 'text_delta',
        text: item.text,
      }];
    }

    if (item.type === 'reasoning' && typeof item.text === 'string') {
      return this.reasoningDeltas(id, item.text);
    }

    if (item.type === 'mcp_tool_call') {
      const output = item.result
        ? JSON.stringify(item.result)
        : item.error?.message ?? '';
      const status = item.status === 'completed' ? 'completed' : 'failed';
      return [{
        type: 'tool_use_end',
        id,
        output,
        status,
      }];
    }

    if (item.type === 'file_change') {
      const output = '';
      const status = item.status === 'completed' ? 'completed' : 'failed';
      return [{
        type: 'tool_use_end',
        id,
        output,
        status,
      }];
    }

    return [];
  }

  private reasoningDeltas(itemId: string, fullText: string): AgentEvent[] {
    const prev = this.reasoningPrev.get(itemId) ?? '';
    // 非单调增长时不同步增量，避免前端重复拼接
    if (fullText.length < prev.length) {
      this.reasoningPrev.set(itemId, fullText);
      return [];
    }
    if (fullText === prev) return [];
    const delta = fullText.slice(prev.length);
    this.reasoningPrev.set(itemId, fullText);
    return delta ? [{ type: 'thinking_delta', text: delta }] : [];
  }
}
