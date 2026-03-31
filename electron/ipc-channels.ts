/**
 * Agent 事件 IPC 通道名与载荷形状（无 electron 运行时依赖，preload / main 均可 import）。
 *
 * 与 `src/lib/transport/types.ts` 的 `IndexedAgentEvent` 同构，便于将来 main 内产出事件后直接投递。
 */
export const IPC_AGENT_EVENT_CHANNEL = 'pp:agent-event' as const;

export interface IndexedAgentEventPayload {
  event: { type: string; [key: string]: unknown };
  index: number;
}
