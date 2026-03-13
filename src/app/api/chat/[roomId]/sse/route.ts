/**
 * GET /api/chat/[roomId]/sse
 *
 * Server-Sent Events 端点：客户端订阅后实时接收该房间的新消息。
 * 每条事件格式：data: <JSON ChatMessage>\n\n
 */

import { NextRequest } from 'next/server';
import { getRoomById } from '@/lib/chat-store';
import { chatSSEBus } from '@/lib/chat-sse-bus';
import type { ChatMessage } from '@/lib/chat-store';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;

  const room = await getRoomById(roomId);
  if (!room) {
    return new Response('data: {"error":"房间不存在"}\n\n', {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // 发送初始心跳，确认连接成功
      controller.enqueue(encoder.encode(': connected\n\n'));

      const handler = (msg: ChatMessage) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));
        } catch {
          // 客户端已断开
        }
      };

      cleanup = chatSSEBus.onRoomMessage(roomId, handler);

      // 每 25 秒发送一次 keepalive，防止代理/浏览器超时断开
      const heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeatTimer);
        }
      }, 25_000);

      // 当流关闭时清理监听器
      const originalCancel = controller.close.bind(controller);
      void originalCancel; // suppress unused warning
      (stream as unknown as { _cleanup: () => void })._cleanup = () => {
        clearInterval(heartbeatTimer);
        cleanup?.();
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
