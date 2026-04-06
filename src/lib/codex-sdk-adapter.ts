/**
 * Codex SDK 事件适配器 — 将 @openai/codex-sdk 的 ThreadEvent 转换为 AgentEvent。
 *
 * 与 CodexStreamParser 逻辑一致，但直接消费 SDK 的 typed events。
 * 使用有状态类以正确拼接 reasoning 项的流式 text。
 *
 * 目标：尽量映射为与 Claude Agent SDK 相同的 AgentEvent（tool_use_* / thinking_delta），
 * 避免 OpenAI 线路在前端「只有纯文本、没有工具卡片」的割裂感。
 */

import type { ThreadEvent, ThreadItem } from '@openai/codex-sdk';
import type { AgentEvent } from '@/types';
import {
  buildError,
  buildTextDelta,
  buildThinkingDelta,
  buildTokenUsage,
  buildToolUseEnd,
  buildToolUseStart,
  formatCodexTodoSummaryLine,
  jsonBashCommand,
  jsonEditInputFromChanges,
  jsonTodoWriteFromCodexItems,
  jsonWebSearchQuery,
  mapCodexTodosToTodoWriteRows,
} from '@/lib/agent-event-builders';

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

  /** todo_list：部分环境仅有 item.updated，补发一次 tool_use_start */
  private todoListToolStarted = new Set<string>();

  /** web_search：与 Claude 侧 WebSearch 卡片对齐 */
  private webSearchToolStarted = new Set<string>();

  /** error 项只上报一次，避免 started/completed 双发 */
  private errorItemEmitted = new Set<string>();

  /** todo_list 上一帧摘要 → 只发 thinking 增量 */
  private todoListThinkingPrev = new Map<string, string>();

  adapt(event: ThreadEvent): { events: AgentEvent[]; sessionId?: string } {
    const events: AgentEvent[] = [];
    let sessionId: string | undefined;

    switch (event.type) {
      case 'thread.started':
        this.reasoningPrev.clear();
        this.todoListToolStarted.clear();
        this.webSearchToolStarted.clear();
        this.errorItemEmitted.clear();
        this.todoListThinkingPrev.clear();
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
        events.push(buildError(event.error?.message ?? 'Codex turn failed'));
        break;

      case 'error':
        events.push(buildError(event.message ?? 'Codex error'));
        break;

      case 'turn.completed':
        if (event.usage && (event.usage.input_tokens > 0 || event.usage.output_tokens > 0)) {
          events.push(
            buildTokenUsage({
              inputTokens: event.usage.input_tokens,
              outputTokens: event.usage.output_tokens,
            }),
          );
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
      return [buildToolUseStart(id, 'Bash', jsonBashCommand(item.command))];
    }

    if (item.type === 'file_change') {
      return [buildToolUseStart(id, 'Edit', jsonEditInputFromChanges(item.changes))];
    }

    if (item.type === 'mcp_tool_call') {
      return [
        buildToolUseStart(
          id,
          `mcp__${item.server}__${item.tool}`,
          typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}),
        ),
      ];
    }

    if (item.type === 'web_search') {
      this.webSearchToolStarted.add(id);
      return [buildToolUseStart(id, 'WebSearch', jsonWebSearchQuery(item.query))];
    }

    if (item.type === 'todo_list') {
      this.todoListToolStarted.add(id);
      return [buildToolUseStart(id, 'TodoWrite', jsonTodoWriteFromCodexItems(item.items))];
    }

    if (item.type === 'error') {
      return this.emitErrorItemOnce(id, item.message);
    }

    return [];
  }

  private adaptItemUpdated(item: ThreadItem): AgentEvent[] {
    if (item.type === 'agent_message' && item.text) {
      return [buildTextDelta(item.text)];
    }

    if (item.type === 'reasoning' && typeof item.text === 'string') {
      return this.reasoningDeltas(item.id, item.text);
    }

    if (item.type === 'web_search') {
      const id = item.id ?? '';
      const out: AgentEvent[] = [];
      if (id && !this.webSearchToolStarted.has(id)) {
        this.webSearchToolStarted.add(id);
        out.push(buildToolUseStart(id, 'WebSearch', jsonWebSearchQuery(item.query)));
      }
      return out;
    }

    if (item.type === 'todo_list') {
      const id = item.id ?? '';
      const out: AgentEvent[] = [];
      if (id && !this.todoListToolStarted.has(id)) {
        this.todoListToolStarted.add(id);
        out.push(buildToolUseStart(id, 'TodoWrite', jsonTodoWriteFromCodexItems(item.items)));
      }
      out.push(...this.todoListThinkingDeltas(id, item.items));
      return out;
    }

    if (item.type === 'error' && item.message) {
      return this.emitErrorItemOnce(item.id ?? '', item.message);
    }

    return [];
  }

  private adaptItemCompleted(item: ThreadItem): AgentEvent[] {
    const id = item.id ?? '';

    if (item.type === 'command_execution') {
      const output = item.aggregated_output ?? '';
      const status = (item.exit_code === 0 ? 'completed' : 'failed') as 'completed' | 'failed';
      return [buildToolUseEnd(id, output, status)];
    }

    if (item.type === 'agent_message' && item.text) {
      return [buildTextDelta(item.text)];
    }

    if (item.type === 'reasoning' && typeof item.text === 'string') {
      return this.reasoningDeltas(id, item.text);
    }

    if (item.type === 'mcp_tool_call') {
      const output = item.result
        ? JSON.stringify(item.result)
        : item.error?.message ?? '';
      const status = item.status === 'completed' ? 'completed' : 'failed';
      return [buildToolUseEnd(id, output, status)];
    }

    if (item.type === 'file_change') {
      const output = '';
      const status = item.status === 'completed' ? 'completed' : 'failed';
      return [buildToolUseEnd(id, output, status)];
    }

    if (item.type === 'web_search') {
      const out: AgentEvent[] = [];
      if (id && !this.webSearchToolStarted.has(id)) {
        this.webSearchToolStarted.add(id);
        out.push(buildToolUseStart(id, 'WebSearch', jsonWebSearchQuery(item.query)));
      }
      if (id) this.webSearchToolStarted.delete(id);
      out.push(
        buildToolUseEnd(id, item.query ? `query: ${item.query}` : '', 'completed'),
      );
      return out;
    }

    if (item.type === 'todo_list') {
      const out: AgentEvent[] = [];
      if (id && !this.todoListToolStarted.has(id)) {
        this.todoListToolStarted.add(id);
        out.push(buildToolUseStart(id, 'TodoWrite', jsonTodoWriteFromCodexItems(item.items)));
      }
      if (id) {
        this.todoListToolStarted.delete(id);
        this.todoListThinkingPrev.delete(id);
      }
      out.push(
        buildToolUseEnd(
          id,
          JSON.stringify({ todos: mapCodexTodosToTodoWriteRows(item.items) }),
          'completed',
        ),
      );
      return out;
    }

    if (item.type === 'error' && item.message) {
      return this.emitErrorItemOnce(id, item.message);
    }

    return [];
  }

  private todoListThinkingDeltas(
    itemId: string,
    items: Array<{ text: string; completed: boolean }>,
  ): AgentEvent[] {
    if (!itemId) return [];
    const full = formatCodexTodoSummaryLine(items);
    const prev = this.todoListThinkingPrev.get(itemId) ?? '';
    if (full.length < prev.length) {
      this.todoListThinkingPrev.set(itemId, full);
      return [];
    }
    if (full === prev) return [];
    if (full.startsWith(prev)) {
      const delta = full.slice(prev.length);
      this.todoListThinkingPrev.set(itemId, full);
      return delta ? [buildThinkingDelta(`${delta}\n`)] : [];
    }
    this.todoListThinkingPrev.set(itemId, full);
    return full ? [buildThinkingDelta(`${full}\n`)] : [];
  }

  private emitErrorItemOnce(id: string, message: string): AgentEvent[] {
    if (!message.trim()) return [];
    const key = id || `_msg_${message.slice(0, 120)}`;
    if (this.errorItemEmitted.has(key)) return [];
    this.errorItemEmitted.add(key);
    return [buildError(message)];
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
    return delta ? [buildThinkingDelta(delta)] : [];
  }
}
