import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getDataDir } from '@/lib/file-store';

/**
 * GET /api/ai-logs?planId=xxx
 * SSE stream for log content. Tails the log file and pushes new content as it appears.
 * Sends `data: {content, size}` events. Sends `event: done` when the plan is no longer active.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const planId = searchParams.get('planId');

  if (!planId) {
    return new Response('planId is required', { status: 400 });
  }

  const logPath = path.join(getDataDir(), 'logs', `${planId}.log`);
  const plansPath = path.join(getDataDir(), 'ai-plans.json');

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      let offset = 0;

      const push = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(text)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const tick = async () => {
        if (closed) return;

        try {
          const stat = await fs.stat(logPath);
          if (stat.size > offset) {
            const fd = await fs.open(logPath, 'r');
            const buffer = Buffer.alloc(stat.size - offset);
            await fd.read(buffer, 0, stat.size - offset, offset);
            await fd.close();
            offset = stat.size;
            push(buffer.toString('utf-8'));
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            closed = true;
            controller.close();
            return;
          }
          // File doesn't exist yet, keep waiting
        }

        // Check if plan is still active
        try {
          const raw = await fs.readFile(plansPath, 'utf-8');
          const data = JSON.parse(raw);
          const plan = data.plans?.find((p: { plan_id: string }) => p.plan_id === planId);
          if (plan && plan.status !== 'planning' && plan.status !== 'running') {
            // Do one final read to flush remaining content
            try {
              const stat = await fs.stat(logPath);
              if (stat.size > offset) {
                const fd = await fs.open(logPath, 'r');
                const buffer = Buffer.alloc(stat.size - offset);
                await fd.read(buffer, 0, stat.size - offset, offset);
                await fd.close();
                push(buffer.toString('utf-8'));
              }
            } catch { /* ignore */ }

            if (!closed) {
              try {
                controller.enqueue(encoder.encode('event: done\ndata: \n\n'));
                controller.close();
              } catch { /* ignore */ }
            }
            closed = true;
            return;
          }
        } catch { /* plans file not readable, keep going */ }

        // Schedule next tick
        if (!closed) {
          setTimeout(tick, 800);
        }
      };

      // Start tailing
      tick();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
