import { NextRequest, NextResponse } from 'next/server';
import { stopDialogue } from '@/lib/dialogue-manager';

/**
 * POST /api/dialogues/:id/stop — 手动停止正在运行的对话
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const ok = await stopDialogue(id);
    if (!ok) {
      return NextResponse.json({ error: 'Dialogue not found or not running' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
