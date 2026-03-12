/**
 * CodexStreamParser — 将 Codex CLI exec --json 的 NDJSON 输出解析为 ChatSSEEvent。
 *
 * Codex 事件类型：thread.started, turn.started, item.started, item.completed,
 * turn.completed, turn.failed, error
 *
 * 映射规则（参考 PLAN-multi-cli-lifecycle）：
 * - thread.started → 记录 sessionId
 * - item.started + command_execution → tool_use_start (Bash)
 * - item.started + file_change → tool_use_start (Edit)
 * - item.started + mcp_tool_call → tool_use_start (对应工具名)
 * - item.completed + command_execution → tool_use_end
 * - item.completed + agent_message → text_delta
 * - turn.failed → error
 */

import type { ChatSSEEvent } from '@/types';

/** Codex exec --json 单行事件（部分字段） */
interface CodexJsonEvent {
  type?: string;
  thread_id?: string;
  item?: {
    id?: string;
    type?: string;
    command?: string;
    text?: string;
    aggregated_output?: string;
    exit_code?: number;
    status?: string;
    name?: string;
    input?: unknown;
  };
  error?: { message?: string };
  usage?: { input_tokens?: number; output_tokens?: number; cached_input_tokens?: number };
}

export class CodexStreamParser {
  sessionId: string | null = null;

  /** 追踪进行中的 command_execution，用于 item.completed 时匹配 tool_use_end */
  private pendingCommands = new Map<string, string>();

  /**
   * 解析单行 NDJSON，返回对应的 ChatSSEEvent 数组。
   */
  parse(line: string): ChatSSEEvent[] {
    const events: ChatSSEEvent[] = [];
    const trimmed = line.trim();
    if (!trimmed) return events;

    let obj: CodexJsonEvent;
    try {
      obj = JSON.parse(trimmed) as CodexJsonEvent;
    } catch {
      return events;
    }

    const t = obj.type;

    if (t === 'thread.started' && obj.thread_id) {
      this.sessionId = obj.thread_id;
      return events;
    }

    if (t === 'item.started' && obj.item) {
      const item = obj.item;
      const id = item.id ?? `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      if (item.type === 'command_execution' && item.command) {
        this.pendingCommands.set(id, item.command);
        events.push({
          type: 'tool_use_start',
          id,
          toolName: 'Bash',
          input: item.command,
        });
      } else if (item.type === 'file_change') {
        events.push({
          type: 'tool_use_start',
          id,
          toolName: 'Edit',
          input: JSON.stringify(item.input ?? {}),
        });
      } else if (item.type === 'mcp_tool_call' && item.name) {
        events.push({
          type: 'tool_use_start',
          id,
          toolName: item.name,
          input: typeof item.input === 'string' ? item.input : JSON.stringify(item.input ?? {}),
        });
      }
      return events;
    }

    if (t === 'item.completed' && obj.item) {
      const item = obj.item;
      const id = item.id ?? '';

      if (item.type === 'command_execution') {
        this.pendingCommands.delete(id);
        const output = item.aggregated_output ?? '';
        const status = (item.exit_code === 0 ? 'completed' : 'failed') as 'completed' | 'failed';
        events.push({
          type: 'tool_use_end',
          id,
          output,
          status,
        });
      } else if (item.type === 'agent_message' && item.text) {
        events.push({
          type: 'text_delta',
          text: item.text,
        });
      }
      return events;
    }

    if (t === 'turn.failed' && obj.error) {
      events.push({
        type: 'error',
        message: obj.error.message ?? 'Codex turn failed',
      });
      return events;
    }

    if (t === 'error' && obj.error) {
      events.push({
        type: 'error',
        message: obj.error.message ?? 'Codex error',
      });
      return events;
    }

    if (t === 'turn.completed' && obj.usage) {
      const usage = obj.usage;
      if (usage.input_tokens != null || usage.output_tokens != null) {
        events.push({
          type: 'token_usage',
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
        });
      }
      return events;
    }

    return events;
  }
}
