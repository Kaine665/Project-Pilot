import { NextRequest } from 'next/server';
import { dialogueEvents, type DialogueSSEEvent } from '@/lib/dialogue-manager';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dialogues/:id/stream — SSE 实时推送对话进展
 *
 * 事件格式：
 *   event: message   — 新消息 { round, speaker, content, ... }
 *   event: status    — 状态变更 { status, currentRound }
 *   event: error     — 错误 { error }
 *   event: done      — 对话结束
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const eventName = `dialogue:${id}`;

      const listener = (event: DialogueSSEEvent) => {
        try {
          const line = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
          controller.enqueue(encoder.encode(line));

          if (event.type === 'done') {
            controller.close();
          }
        } catch {
          // stream closed
        }
      };

      dialogueEvents.on(eventName, listener);

      // 心跳（防止连接超时）
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);

      // cleanup on client disconnect
      _request.signal.addEventListener('abort', () => {
        dialogueEvents.off(eventName, listener);
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
