/**
 * GET  /api/chat/[roomId]/messages          — 返回历史消息
 * POST /api/chat/[roomId]/messages          — 发送新消息，广播到 SSE 客户端
 * Body: { senderId, senderName, content }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMessages, appendMessage, getRoomById } from '@/lib/chat-store';
import { chatSSEBus } from '@/lib/chat-sse-bus';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const { roomId } = await params;
    const room = await getRoomById(roomId);
    if (!room) {
      return NextResponse.json({ error: '房间不存在' }, { status: 404 });
    }
    const messages = await getMessages(roomId);
    return NextResponse.json({ messages });
  } catch (err) {
    console.error('[chat/messages] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const { roomId } = await params;
    const room = await getRoomById(roomId);
    if (!room) {
      return NextResponse.json({ error: '房间不存在' }, { status: 404 });
    }

    const body = await req.json();
    const senderId = (body.senderId ?? '').toString().trim();
    const senderName = (body.senderName ?? '').toString().trim();
    const content = (body.content ?? '').toString().trim();

    if (!senderId || !senderName) {
      return NextResponse.json({ error: '缺少发送者信息' }, { status: 400 });
    }
    if (!content || content.length > 4000) {
      return NextResponse.json({ error: '消息内容无效（最多 4000 字符）' }, { status: 400 });
    }

    const message = await appendMessage({ roomId, senderId, senderName, content });

    // 广播到同房间的所有 SSE 客户端
    chatSSEBus.broadcastMessage(roomId, message);

    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    console.error('[chat/messages] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
