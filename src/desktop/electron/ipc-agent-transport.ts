/**
 * Electron IPC Transport（备用，未接线）
 *
 * 当前架构：Hono + Agent 跑在独立子进程，渲染进程通过 localhost SSE 收流（见 SSETransportSink）。
 * 此类仅在「Agent 引擎迁入 Electron main」或 main 与子进程间建立桥接时使用：
 *   main 持有 `ElectronIpcTransportSink`，将 `IndexedAgentEventPayload` 推到 renderer。
 *
 * Renderer 侧已暴露 `window.electronAgent?.onAgentEvent`（preload），与 {@link IPC_AGENT_EVENT_CHANNEL} 对应。
 */

import type { BrowserWindow } from 'electron';
import {
  IPC_AGENT_EVENT_CHANNEL,
  type IndexedAgentEventPayload,
} from './ipc-channels';

export { IPC_AGENT_EVENT_CHANNEL, type IndexedAgentEventPayload } from './ipc-channels';

export class ElectronIpcTransportSink {
  private ended = false;

  constructor(
    private readonly target: BrowserWindow,
    private readonly channel: string = IPC_AGENT_EVENT_CHANNEL,
  ) {}

  send(item: IndexedAgentEventPayload): void {
    if (this.ended) return;
    if (!this.target.isDestroyed()) {
      this.target.webContents.send(this.channel, item);
    }
    const t = item.event.type;
    if (t === 'stream_end' || t === 'awaiting_sub_agents') {
      this.close();
    }
  }

  /** IPC 无 HTTP 保活需求；与 TransportSink 签名对齐，便于将来互换。 */
  heartbeat(): void {}

  close(): void {
    this.ended = true;
  }
}
