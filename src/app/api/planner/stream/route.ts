import { NextRequest, NextResponse } from 'next/server';
import { plannerManager } from '@/lib/planner-manager';
import type { ChatSSEEvent } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/planner/stream?sessionId=xxx&since=0
 * SSE endpoint that streams events from a running planner process.
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  const since = parseInt(request.nextUrl.searchParams.get('since') ?? '0', 10);

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  let unsubscribeFn: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`:ok\n\n`));

      const push = (event: ChatSSEEvent, index: number) => {
        try {
          const payload = JSON.stringify({ ...event, _idx: index });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch {
          // Controller may be closed
        }

        if (event.type === 'done') {
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }
      };

      unsubscribeFn = plannerManager.subscribe(sessionId!, since, push);

      if (!unsubscribeFn) {
        const noRunPayload = JSON.stringify({ type: 'done' as const, _idx: -1 });
        controller.enqueue(encoder.encode(`data: ${noRunPayload}\n\n`));
        controller.close();
      }
    },
    cancel() {
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
