import { NextRequest } from 'next/server';
import { proxySidecarSSE } from '@/lib/sidecar-bridge';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agent-chat/stream?sessionId=xxx&since=0
 * Proxy SSE stream from Agent Sidecar process.
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  const since = request.nextUrl.searchParams.get('since') ?? '0';

  if (!sessionId) {
    return new Response(
      `data: ${JSON.stringify({ type: 'error', message: 'sessionId is required' })}\n\n`,
      {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
        },
      },
    );
  }

  return proxySidecarSSE(`/agent-chat/stream?sessionId=${encodeURIComponent(sessionId)}&since=${since}`);
}
