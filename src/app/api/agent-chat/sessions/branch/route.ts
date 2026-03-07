import { NextRequest, NextResponse } from 'next/server';
import { branchSession } from '@/lib/agent-chat-manager';

/**
 * POST /api/agent-chat/sessions/branch
 *
 * 从指定消息索引处分支，创建一个新会话（包含到该索引为止的所有消息）。
 * 直接调用 store 函数，不依赖 agentChatManager 单例，HMR 友好。
 */
export async function POST(req: NextRequest) {
  try {
    const { sourceSessionId, branchAtIndex } = await req.json();
    if (!sourceSessionId || typeof branchAtIndex !== 'number') {
      return NextResponse.json(
        { error: 'sourceSessionId (string) and branchAtIndex (number) are required' },
        { status: 400 },
      );
    }

    const newSession = await branchSession(sourceSessionId, branchAtIndex);

    return NextResponse.json({
      sessionId: newSession.id,
      title: newSession.title,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message.includes('not found') || message.includes('out of range') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
