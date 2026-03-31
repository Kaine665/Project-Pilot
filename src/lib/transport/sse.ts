/**
 * SSE Transport — 将 AgentEvent 通过 Server-Sent Events 推送到浏览器客户端。
 *
 * 封装 hono/streaming 的 SSE 写入细节，使路由层保持干净。
 * 将来新增 WebSocket / Bot Transport 时，只需实现 TransportSink 接口。
 */

import type { SSEStreamingApi } from 'hono/streaming';
import type { AgentEvent } from '@/types';
import type { IndexedAgentEvent, TransportSink } from './types';
import { isStreamTerminal } from './types';

export class SSETransportSink implements TransportSink {
  private ended = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly stream: SSEStreamingApi,
    heartbeatIntervalMs = 30_000,
  ) {
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat();
    }, heartbeatIntervalMs);

    stream.onAbort(() => this.cleanup());
  }

  send(item: IndexedAgentEvent): void {
    if (this.ended) return;
    const payload = JSON.stringify({ ...item.event, _idx: item.index });
    this.stream.writeSSE({ data: payload }).catch(() => { /* connection closed */ });

    if (isStreamTerminal(item.event)) {
      this.close();
    }
  }

  heartbeat(): void {
    if (this.ended) return;
    this.stream.writeSSE({ data: ':heartbeat' }).catch(() => this.cleanup());
  }

  close(): void {
    if (this.ended) return;
    this.cleanup();
    this.stream.close();
  }

  private cleanup(): void {
    this.ended = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

/**
 * 将 AgentEvent 序列化为 SSE data 帧格式（纯字符串）。
 * 可用于不使用 TransportSink 的简单场景（如一次性错误响应）。
 */
export function agentEventToSSEData(event: AgentEvent, index = -1): string {
  return JSON.stringify({ ...event, _idx: index });
}
