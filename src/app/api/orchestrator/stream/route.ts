import { NextRequest } from 'next/server';
import { orchestratorManager } from '@/lib/chat-managers/orchestrator-manager';
import type { OrchestratorSSEEvent } from '@/types/orchestrator';

export const dynamic = 'force-dynamic';

/**
 * GET /api/orchestrator/stream?orchId=xxx&since=0 — SSE event stream
 */
export async function GET(request: NextRequest) {
  const orchId = request.nextUrl.searchParams.get('orchId');
  const since = parseInt(request.nextUrl.searchParams.get('since') ?? '0', 10);

  if (!orchId) {
    return new Response(JSON.stringify({ error: 'orchId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  let unsubscribeFn: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Initial SSE handshake
      controller.enqueue(encoder.encode(':ok\n\n'));

      const push = (event: OrchestratorSSEEvent, index: number) => {
        try {
          const payload = JSON.stringify({ ...event, _idx: index });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch {
          // Controller may be closed
        }

        if (event.type === 'orch_done') {
          try { controller.close(); } catch { /* already closed */ }
        }
      };

      unsubscribeFn = orchestratorManager.subscribe(orchId, since, push);

      if (!unsubscribeFn) {
        // No such orchestration — send done and close
        const donePayload = JSON.stringify({ type: 'orch_done' as const, _idx: -1 });
        controller.enqueue(encoder.encode(`data: ${donePayload}\n\n`));
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
