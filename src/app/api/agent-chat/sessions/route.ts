import { NextRequest, NextResponse } from 'next/server';
import { listSessions, listSessionsByProject, listAllSessions, deleteSessionFromDisk } from '@/lib/agent-chat-manager';
import { sidecarFetch } from '@/lib/sidecar-bridge';

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
  } else if (projectKey) {
    // 按项目过滤所有会话（跨 Agent）
    const all = await listAllSessions();
    sessions = all.filter(s => s.projectKey === projectKey);
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

  // Clear in-memory run from sidecar + delete from disk
  sidecarFetch('/agent-chat/clear', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  }).catch(() => { /* best-effort, sidecar auto-sweeps anyway */ });

  const deleted = await deleteSessionFromDisk(sessionId);
  if (!deleted) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
