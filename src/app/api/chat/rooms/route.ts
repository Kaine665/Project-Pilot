/**
 * GET  /api/chat/rooms        — 返回所有房间
 * POST /api/chat/rooms        — 创建新房间 { name: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRooms, createRoom } from '@/lib/chat-store';

export async function GET() {
  try {
    const rooms = await getRooms();
    return NextResponse.json({ rooms });
  } catch (err) {
    console.error('[chat/rooms] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = (body.name ?? '').toString().trim();

    if (!name || name.length < 1 || name.length > 50) {
      return NextResponse.json(
        { error: '房间名长度必须在 1-50 个字符之间' },
        { status: 400 },
      );
    }

    const room = await createRoom(name);
    return NextResponse.json({ room }, { status: 201 });
  } catch (err) {
    console.error('[chat/rooms] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
