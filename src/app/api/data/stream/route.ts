import { NextRequest } from 'next/server';
import fs from 'fs';
import { getFlowDataPath, ensureDataDirV2Migrated } from '@/lib/file-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const project = request.nextUrl.searchParams.get('project');
  if (!project) {
    return new Response('project is required', { status: 400 });
  }

  await ensureDataDirV2Migrated();
  const filePath = getFlowDataPath(project);

  const encoder = new TextEncoder();

  let watcher: fs.FSWatcher | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(': connected\n\n'));

      watcher = fs.watch(filePath, (eventType) => {
        if (eventType === 'change') {
          try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(raw);
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
            );
          } catch {
            // File might be mid-write, ignore parse errors
          }
        }
      });

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          // Connection closed, cleanup will happen in cancel
        }
      }, 30000);
    },
    cancel() {
      watcher?.close();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
