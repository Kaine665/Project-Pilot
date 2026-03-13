/**
 * POST /api/chat/users
 * Body: { username: string }
 * Response: { user: ChatUser }
 *
 * 查找或创建用户（无密码，MVP 简化实现）
 */

import { NextRequest, NextResponse } from 'next/server';
import { upsertUser } from '@/lib/chat-store';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const username = (body.username ?? '').toString().trim();

    if (!username || username.length < 1 || username.length > 30) {
      return NextResponse.json(
        { error: '用户名长度必须在 1-30 个字符之间' },
        { status: 400 },
      );
    }

    const user = await upsertUser(username);
    return NextResponse.json({ user });
  } catch (err) {
    console.error('[chat/users] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
