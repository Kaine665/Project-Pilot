/**
 * Transport layer — 将 AgentEvent 投递到各类消费端。
 *
 * 目前实现：
 *   - SSETransportSink  ← 浏览器 Web 前端
 *
 * 将来可扩展：
 *   - WebSocketTransportSink ← 桌面客户端 / 双向交互
 *   - BotTransportSink       ← Telegram / 微信 / Discord
 *
 * Electron 备用（main → renderer IPC，与 Hono 子进程架构未接线）：
 *   - electron/ipc-agent-transport.ts — ElectronIpcTransportSink
 *   - electron/ipc-channels.ts — IPC_AGENT_EVENT_CHANNEL、IndexedAgentEventPayload
 */

export type { TransportSink, IndexedAgentEvent } from './types';
export { isStreamTerminal } from './types';
export { SSETransportSink, agentEventToSSEData } from './sse';
