/**
 * Codex SDK 事件适配器 — 将 @openai/codex-sdk 的 ThreadEvent 转换为 ChatSSEEvent。
 *
 * 与 CodexStreamParser 逻辑一致，但直接消费 SDK 的 typed events。
 */

import type { ThreadEvent, ThreadItem } from '@openai/codex-sdk';
import type { ChatSSEEvent } from '@/types';

/**
 * 将单个 ThreadEvent 转换为零或多个 ChatSSEEvent。
 * 返回 sessionId 用于 resume（仅 thread.started 时）。
 */
export function adaptCodexEvent(event: ThreadEvent): { events: ChatSSEEvent[]; sessionId?: string } {
  const events: ChatSSEEvent[] = [];
  let sessionId: string | undefined;

  switch (event.type) {
    case 'thread.started':
      sessionId = event.thread_id;
      break;

    case 'item.started':
      events.push(...adaptItemStarted(event.item));
      break;

    case 'item.updated':
      events.push(...adaptItemUpdated(event.item));
      break;

    case 'item.completed':
      events.push(...adaptItemCompleted(event.item));
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

function adaptItemStarted(item: ThreadItem): ChatSSEEvent[] {
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

function adaptItemUpdated(item: ThreadItem): ChatSSEEvent[] {
  if (item.type === 'agent_message' && item.text) {
    return [{ type: 'text_delta', text: item.text }];
  }
  return [];
}

function adaptItemCompleted(item: ThreadItem): ChatSSEEvent[] {
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
