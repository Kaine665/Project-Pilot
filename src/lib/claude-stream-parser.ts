import type { ChatSSEEvent } from '@/types';

/**
 * Parse a single NDJSON line from `claude -p --verbose --output-format stream-json`
 * and convert it into ChatSSEEvents.
 *
 * With --verbose, Claude CLI outputs granular streaming events:
 * - {"type":"system","subtype":"init",...} — session init (skip)
 * - {"type":"assistant","message":{...}} — assistant turn start (content usually empty)
 * - {"type":"content_block_start","index":N,"content_block":{...}} — block start
 * - {"type":"content_block_delta","index":N,"delta":{...}} — streaming delta
 * - {"type":"content_block_stop","index":N} — block end
 * - {"type":"user","message":{...}} — tool results
 * - {"type":"result","subtype":"success",...} — final result
 */

interface ToolAccumulator {
  id: string;
  name: string;
  inputJson: string;
}

/** Tools whose is_error should be treated as completed (flow-control tools) */
const FLOW_CONTROL_TOOLS = new Set(['ExitPlanMode', 'EnterPlanMode']);

export class StreamParser {
  /** Track tool_use blocks being built up from deltas */
  private toolAccumulators = new Map<number, ToolAccumulator>();

  /** Map tool_use id → tool name for resolving status in tool_result events */
  private toolNames = new Map<string, string>();

  /** Claude CLI session ID, captured from system.init or result events */
  sessionId: string | null = null;

  parse(line: string): ChatSSEEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return [];
    }

    const events: ChatSSEEvent[] = [];

    switch (json.type) {
      case 'system': {
        // {"type":"system","subtype":"init","session_id":"xxx",...}
        if (json.subtype === 'init' && typeof json.session_id === 'string') {
          this.sessionId = json.session_id;
        }
        break;
      }

      case 'assistant': {
        // With --verbose, assistant turn start usually has empty content.
        // But if content is pre-filled (e.g. resumed), emit it.
        const message = json.message as { content?: Array<Record<string, unknown>> } | undefined;
        if (!message?.content?.length) break;

        for (const block of message.content) {
          if (block.type === 'text' && typeof block.text === 'string' && block.text) {
            events.push({ type: 'text_delta', text: block.text as string });
          } else if (block.type === 'tool_use') {
            const input = typeof block.input === 'string'
              ? block.input
              : JSON.stringify(block.input);
            this.toolNames.set(block.id as string, block.name as string);
            events.push({
              type: 'tool_use_start',
              id: block.id as string,
              toolName: block.name as string,
              input,
            });
          }
        }
        break;
      }

      case 'content_block_start': {
        const index = json.index as number;
        const block = json.content_block as Record<string, unknown> | undefined;
        if (!block) break;

        if (block.type === 'tool_use') {
          // Start accumulating tool input
          this.toolAccumulators.set(index, {
            id: block.id as string,
            name: block.name as string,
            inputJson: '',
          });
        }
        // text blocks: nothing to emit yet, wait for deltas
        break;
      }

      case 'content_block_delta': {
        const index = json.index as number;
        const delta = json.delta as Record<string, unknown> | undefined;
        if (!delta) break;

        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          events.push({ type: 'text_delta', text: delta.text as string });
        } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          const acc = this.toolAccumulators.get(index);
          if (acc) {
            acc.inputJson += delta.partial_json;
          }
        }
        break;
      }

      case 'content_block_stop': {
        const index = json.index as number;
        const acc = this.toolAccumulators.get(index);
        if (acc) {
          // Tool input is now complete, emit the tool_use_start event
          this.toolNames.set(acc.id, acc.name);
          events.push({
            type: 'tool_use_start',
            id: acc.id,
            toolName: acc.name,
            input: acc.inputJson,
          });
          this.toolAccumulators.delete(index);
        }
        break;
      }

      case 'user': {
        const message = json.message as { content?: Array<Record<string, unknown>> } | undefined;
        if (!message?.content) break;

        for (const block of message.content) {
          if (block.type === 'tool_result') {
            const toolId = block.tool_use_id as string;
            const output = typeof block.content === 'string'
              ? (block.content as string).slice(0, 3000)
              : JSON.stringify(block.content).slice(0, 3000);
            // Flow-control tools (e.g. ExitPlanMode) return is_error=true
            // as a signal for user intervention, not an actual failure.
            const toolName = this.toolNames.get(toolId);
            const isFlowControl = toolName && FLOW_CONTROL_TOOLS.has(toolName);
            events.push({
              type: 'tool_use_end',
              id: toolId,
              output,
              status: (block.is_error && !isFlowControl) ? 'failed' : 'completed',
            });
          }
        }
        break;
      }

      case 'result':
        // Also capture session_id from result if not yet captured
        if (!this.sessionId && typeof json.session_id === 'string') {
          this.sessionId = json.session_id;
        }
        // NOTE: Do NOT emit { type: 'done' } here.
        // The 'done' event is emitted by BaseChatManager's close handler,
        // which fires AFTER onProcessClose (title extraction, action processing,
        // assistant message commit). Emitting 'done' here would close the SSE
        // connection prematurely, causing onProcessClose events to be lost.
        break;

      default:
        break;
    }

    return events;
  }
}

/**
 * Stateless parse function for backward compatibility.
 * For streaming, prefer using StreamParser instance.
 */
export function parseStreamLine(line: string): ChatSSEEvent[] {
  const parser = new StreamParser();
  return parser.parse(line);
}

/**
 * A line buffer that handles partial NDJSON lines from stdout chunks.
 * stdout may split a JSON line across multiple data chunks.
 */
export class LineBuffer {
  private buffer = '';

  /** Feed a chunk of data and return complete lines */
  feed(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];

    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      if (line.trim()) {
        lines.push(line);
      }
    }

    return lines;
  }

  /** Flush remaining buffer content */
  flush(): string | null {
    const remaining = this.buffer.trim();
    this.buffer = '';
    return remaining || null;
  }
}
