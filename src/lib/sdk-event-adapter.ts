/**
 * SDK Event Adapter — 将 Claude Agent SDK 的 SDKMessage 转换为内部 ChatSSEEvent。
 *
 * SDK query() 配合 includePartialMessages: true 输出类型化的 SDKMessage 事件流。
 * 本适配器将其映射为 UI 前端已适配的 ChatSSEEvent 联合类型。
 *
 * SDK 消息类型映射：
 * - stream_event (SDKPartialAssistantMessage): 流式增量 → text_delta / tool_use_start
 * - assistant (SDKAssistantMessage): 完整助手消息（resume 时预填充）
 * - user (SDKUserMessage): 工具结果 → tool_use_end
 * - result (SDKResultMessage): 会话结束（不 emit done，由调用方统一处理）
 * - system.init (SDKSystemMessage): 捕获 session_id
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ChatSSEEvent } from '@/types';

/** Tools whose is_error should be treated as completed (flow-control tools) */
const FLOW_CONTROL_TOOLS = new Set(['ExitPlanMode', 'EnterPlanMode']);

/**
 * 有状态的 SDK 事件适配器。
 * 追踪 tool_use 块的流式拼装和 id → name 映射。
 */
export class SdkEventAdapter {
  /** Track tool_use blocks being built up from stream_event deltas */
  private toolAccumulators = new Map<number, { id: string; name: string; inputJson: string }>();

  /** Map tool_use id → tool name for resolving status in tool_result events */
  private toolNames = new Map<string, string>();

  /** Claude SDK session ID, captured from system.init event */
  sessionId: string | null = null;

  /**
   * 是否已收到过 stream_event（流式增量）。
   * 用于避免完整 assistant 消息导致的重复输出。
   * SDK 设置 includePartialMessages: true 时，会同时发送增量和完整消息，
   * 我们只取增量，丢弃完整消息中的文本内容（但保留工具调用状态）。
   */
  private hasReceivedStreamEvents = false;

  /**
   * 将一个 SDKMessage 转换为零或多个 ChatSSEEvent。
   */
  adapt(msg: SDKMessage): ChatSSEEvent[] {
    const events: ChatSSEEvent[] = [];

    // 用 msg 的 type 字段进行分发
    if (msg.type === 'system' && 'subtype' in msg && msg.subtype === 'init') {
      // SDKSystemMessage — 初始化消息
      this.sessionId = msg.session_id;
      return events;
    }

    if (msg.type === 'stream_event') {
      // SDKPartialAssistantMessage — 流式增量事件
      // msg.event 是 BetaRawMessageStreamEvent
      this.hasReceivedStreamEvents = true;
      return this.handleStreamEvent(msg.event);
    }

    if (msg.type === 'assistant') {
      // SDKAssistantMessage — 完整助手消息（resume 预填充 or 非流式模式）
      return this.handleAssistantMessage(msg);
    }

    if (msg.type === 'user') {
      // SDKUserMessage — 工具结果
      return this.handleUserMessage(msg);
    }

    if (msg.type === 'result') {
      // SDKResultMessage — 会话结束
      if (!this.sessionId && msg.session_id) {
        this.sessionId = msg.session_id;
      }
      // 如果是错误结果（error_during_execution 等），emit error event
      if (msg.subtype !== 'success') {
        events.push({ type: 'error', message: `SDK query ended: ${msg.subtype}` });
      }
      // NOTE: 不在此处 emit done — done 由 AgentChatManager 在 query 迭代结束后统一处理
      return events;
    }

    // 其他消息类型（status, tool_progress 等）暂时忽略
    return events;
  }

  /**
   * 处理 BetaRawMessageStreamEvent（流式增量）。
   * 这些事件和旧 CLI NDJSON 的 content_block_* 事件同构。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleStreamEvent(event: any): ChatSSEEvent[] {
    const events: ChatSSEEvent[] = [];
    const type = event?.type;

    switch (type) {
      case 'content_block_start': {
        const index = event.index as number;
        const block = event.content_block;
        if (block?.type === 'tool_use') {
          this.toolAccumulators.set(index, {
            id: block.id,
            name: block.name,
            inputJson: '',
          });
        }
        break;
      }

      case 'content_block_delta': {
        const index = event.index as number;
        const delta = event.delta;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          events.push({ type: 'text_delta', text: delta.text });
        } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          const acc = this.toolAccumulators.get(index);
          if (acc) {
            acc.inputJson += delta.partial_json;
          }
        }
        break;
      }

      case 'content_block_stop': {
        const index = event.index as number;
        const acc = this.toolAccumulators.get(index);
        if (acc) {
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

      case 'message_start': {
        // 捕获输入 token 数（系统提示词 + 历史消息 + 当前用户消息）
        const usage = event.message?.usage;
        if (usage && typeof usage.input_tokens === 'number') {
          events.push({ type: 'token_usage', inputTokens: usage.input_tokens, outputTokens: 0 });
        }
        break;
      }

      case 'message_delta': {
        // 捕获输出 token 数（当前助手回复）
        const usage = event.usage;
        if (usage && typeof usage.output_tokens === 'number') {
          events.push({ type: 'token_usage', inputTokens: 0, outputTokens: usage.output_tokens });
        }
        break;
      }

      // message_stop — 不需要映射
      default:
        break;
    }

    return events;
  }

  /**
   * 处理完整的 SDKAssistantMessage（resume 预填充或非流式）。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleAssistantMessage(msg: any): ChatSSEEvent[] {
    const events: ChatSSEEvent[] = [];
    const content = msg.message?.content;
    if (!Array.isArray(content)) return events;

    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text) {
        // 如果已经通过 stream_event 接收过增量，跳过完整消息中的文本
        // 避免同一句话被显示两次
        if (!this.hasReceivedStreamEvents) {
          events.push({ type: 'text_delta', text: block.text });
        }
      } else if (block.type === 'tool_use') {
        const input = typeof block.input === 'string'
          ? block.input
          : JSON.stringify(block.input);
        this.toolNames.set(block.id, block.name);
        events.push({
          type: 'tool_use_start',
          id: block.id,
          toolName: block.name,
          input,
        });
      }
    }

    // 如果助手消息有错误，emit error
    if (msg.error) {
      events.push({ type: 'error', message: `Assistant error: ${msg.error}` });
    }

    return events;
  }

  /**
   * 处理 SDKUserMessage（工具结果）。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleUserMessage(msg: any): ChatSSEEvent[] {
    const events: ChatSSEEvent[] = [];
    const content = msg.message?.content;
    if (!Array.isArray(content)) return events;

    for (const block of content) {
      if (block.type === 'tool_result') {
        const toolId = block.tool_use_id as string;
        const output = typeof block.content === 'string'
          ? block.content.slice(0, 3000)
          : JSON.stringify(block.content).slice(0, 3000);
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

    return events;
  }
}
