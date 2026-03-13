/**
 * 进程内 SSE 广播总线
 *
 * 使用 Node.js EventEmitter 在 Next.js Route Handler 之间传递聊天事件。
 * 同一进程内的所有 SSE 客户端通过此总线实时接收消息。
 */

import { EventEmitter } from 'events';
import type { ChatMessage } from './chat-store';

class ChatSSEBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(200); // 支持最多 200 个并发 SSE 连接
  }

  broadcastMessage(roomId: string, message: ChatMessage): void {
    this.emit(`room:${roomId}`, message);
  }

  onRoomMessage(roomId: string, handler: (msg: ChatMessage) => void): () => void {
    const event = `room:${roomId}`;
    this.on(event, handler);
    return () => this.off(event, handler);
  }
}

// 单例：确保整个 Next.js 进程只有一个实例
const globalKey = '__chat_sse_bus__';
type GlobalWithBus = typeof globalThis & { [globalKey]?: ChatSSEBus };

const g = global as GlobalWithBus;
if (!g[globalKey]) {
  g[globalKey] = new ChatSSEBus();
}

export const chatSSEBus = g[globalKey]!;
