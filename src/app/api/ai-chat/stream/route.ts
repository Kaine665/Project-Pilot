import { NextRequest, NextResponse } from 'next/server';
import { processManager } from '@/lib/process-manager';
import type { ChatSSEEvent } from '@/types';

// Prevent Next.js from buffering the SSE response
export const dynamic = 'force-dynamic';

/**
 * GET /api/ai-chat/stream?taskId=xxx&since=0
 * SSE endpoint that streams events from a running (or recently completed) process.
 *
 * - Replays buffered events from `since` index
 * - Then streams new events in real-time
 * - Disconnecting does NOT stop the backend process
 */
export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get('taskId');
  const since = parseInt(request.nextUrl.searchParams.get('since') ?? '0', 10);

  if (!taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  let unsubscribeFn: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial SSE comment to flush response headers through any buffering layers
      controller.enqueue(encoder.encode(`:ok\n\n`));

      let pushCount = 0;
      const push = (event: ChatSSEEvent, index: number) => {
        try {
          const payload = JSON.stringify({ ...event, _idx: index });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          pushCount++;
          if (event.type !== 'text_delta' || pushCount <= 3) {
            console.log(`[SSE] push #${pushCount}: ${event.type}, idx=${index}`);
          }
        } catch {
          // Controller may be closed
        }

        // Auto-close the stream after 'done' event
        if (event.type === 'done') {
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }
      };

      unsubscribeFn = processManager.subscribe(taskId!, since, push);

      if (!unsubscribeFn) {
        // No active or recent run
        const noRunPayload = JSON.stringify({ type: 'done' as const, _idx: -1 });
        controller.enqueue(encoder.encode(`data: ${noRunPayload}\n\n`));
        controller.close();
      }
    },
    cancel() {
      // CRITICAL: only unsubscribe the listener, do NOT kill the process
      if (unsubscribeFn) {
        unsubscribeFn();
        unsubscribeFn = null;
      }
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
