import { NextRequest, NextResponse } from 'next/server';
import { listGuestSessions } from '@/lib/agent-chat-manager';

/**
 * GET /api/agent-chat/sessions/[id]/children
 * 查询所有 parentSessionId === id 的子会话（不含 messages）。
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // listGuestSessions 按 parentSessionId 过滤所有会话（不限 guest）
  const children = await listGuestSessions(id);
  return NextResponse.json({ children }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
