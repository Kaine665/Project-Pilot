import { NextRequest, NextResponse } from 'next/server';
import { agentChatManager } from '@/lib/agent-chat-manager';
import { listSessions, listSessionsByProject, listAllSessions, deleteSessionFromDisk } from '@/lib/agent-chat-manager';

/**
 * GET /api/agent-chat/sessions?agentId=xxx&projectKey=yyy
 * List chat sessions. Supports filtering by agent and/or project scope.
 */
export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get('agentId');
  const projectKey = request.nextUrl.searchParams.get('projectKey');

  let sessions;
  if (agentId && projectKey) {
    sessions = await listSessionsByProject(agentId, projectKey);
  } else if (agentId) {
    sessions = await listSessions(agentId);
  } else {
    sessions = await listAllSessions();
  }

  return NextResponse.json({ sessions }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * DELETE /api/agent-chat/sessions?sessionId=xxx
 * Delete an agent chat session.
 */
export async function DELETE(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  // Clear from in-memory runs + delete from disk
  agentChatManager.clear(sessionId);
  const deleted = await deleteSessionFromDisk(sessionId);
  if (!deleted) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
