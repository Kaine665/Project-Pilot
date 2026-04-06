/**
 * AgentEvent 轻量构造与工具输入规范化（Claude / Codex 适配器共用）。
 *
 * 原则：无状态纯函数 + 单一出口形状，避免在多个适配器里复制字面量。
 * 不引入 IStreamAdapter 等抽象；有状态流式拼装仍留在各自 Adapter 类内。
 */

import type { AgentEvent } from '@/types';

// ── AgentEvent 构造 ─────────────────────────────────────────────────────────

export function buildTextDelta(text: string): AgentEvent {
  return { type: 'text_delta', text };
}

export function buildThinkingDelta(text: string): AgentEvent {
  return { type: 'thinking_delta', text };
}

export function buildToolUseStart(id: string, toolName: string, input: string): AgentEvent {
  return { type: 'tool_use_start', id, toolName, input };
}

export function buildToolUseEnd(
  id: string,
  output: string,
  status: 'completed' | 'failed',
): AgentEvent {
  return { type: 'tool_use_end', id, output, status };
}

export function buildError(message: string): AgentEvent {
  return { type: 'error', message };
}

export function buildTokenUsage(params: {
  inputTokens: number;
  outputTokens: number;
  contextWindow?: number;
  final?: boolean;
}): AgentEvent {
  return {
    type: 'token_usage',
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    ...(params.contextWindow != null && params.contextWindow > 0
      ? { contextWindow: params.contextWindow }
      : {}),
    ...(params.final === true ? { final: true as const } : {}),
  };
}

// ── 工具 input 字符串（与 tool-utils getToolOneLiner 等对齐）────────────────

/** Claude SDK tool_use.input 可能是 JSON 字符串或对象 */
export function stringifyToolInput(input: unknown): string {
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return '';
  }
}

/** Codex command_execution → Bash 与 Claude 一致的 { command } JSON */
export function jsonBashCommand(command: string): string {
  return JSON.stringify({ command });
}

/** WebSearch 卡片：{ query } */
export function jsonWebSearchQuery(query: string): string {
  return JSON.stringify({ query });
}

/** Codex file_change → Edit：带首个 file_path 便于一行摘要 */
export function jsonEditInputFromChanges(
  changes: Array<{ path: string; kind: string }>,
): string {
  const first = changes[0];
  return JSON.stringify({
    ...(first?.path ? { file_path: first.path } : {}),
    changes,
  });
}

export type CodexTodoItem = { text: string; completed: boolean };

/** Codex todo_list → TodoWrite 行结构（贴近 Claude TodoWrite） */
export function mapCodexTodosToTodoWriteRows(items: CodexTodoItem[]): Array<{
  content: string;
  status: string;
  activeForm: string;
}> {
  return items.map((t) => ({
    content: t.text,
    status: t.completed ? 'completed' : 'pending',
    activeForm: t.text,
  }));
}

export function jsonTodoWriteFromCodexItems(items: CodexTodoItem[]): string {
  return JSON.stringify({ merge: true, todos: mapCodexTodosToTodoWriteRows(items) });
}

/** 待办摘要一行（用于 Codex thinking 增量，非 AgentEvent 契约） */
export function formatCodexTodoSummaryLine(items: CodexTodoItem[]): string {
  if (!items.length) return '';
  return items.map((t) => `${t.completed ? '✓' : '○'} ${t.text}`).join(' · ');
}
