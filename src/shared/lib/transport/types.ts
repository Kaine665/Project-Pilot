/**
 * Transport 层抽象——将 AgentEvent 从领域层投递到各类消费端。
 *
 * 每种传输协议（SSE / WebSocket / Bot）实现此接口即可接入，
 * 核心引擎（AgentChatManager）只产出 AgentEvent，不感知序列化细节。
 */

import type { AgentEvent } from '@/types';

/**
 * 带序列号的领域事件——Transport 层使用序列号做断点续传 / 幂等推送。
 * Electron 备用 IPC 载荷见 `electron/ipc-channels.ts`（JSON 形状一致）。
 */
export interface IndexedAgentEvent {
  event: AgentEvent;
  index: number;
}

/**
 * 通用 Transport 发送器。
 *
 * 实现者需处理序列化格式和连接生命周期；
 * 对调用方来说只需要 send / close，无需了解底层协议。
 */
export interface TransportSink {
  /** 推送一条事件到消费端 */
  send(item: IndexedAgentEvent): void;
  /** 发送心跳（部分协议需要保活） */
  heartbeat(): void;
  /** 关闭连接 / 释放资源 */
  close(): void;
}

/**
 * 将事件流终止信号的判断从 route 层内联代码抽到此处，
 * 使不同 Transport 可共用同一套终止逻辑。
 */
export function isStreamTerminal(event: AgentEvent): boolean {
  return event.type === 'stream_end' || event.type === 'awaiting_sub_agents';
}
