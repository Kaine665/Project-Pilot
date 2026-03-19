import { NextRequest, NextResponse } from 'next/server';
import { getDialogue, deleteDialogue } from '@/lib/dialogue-manager';

/**
 * GET /api/dialogues/:id — 获取对话详情（含 messages）
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const dialogue = await getDialogue(id);
    if (!dialogue) {
      return NextResponse.json({ error: 'Dialogue not found' }, { status: 404 });
    }
    return NextResponse.json(dialogue);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * DELETE /api/dialogues/:id — 删除对话
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const ok = await deleteDialogue(id);
    if (!ok) {
      return NextResponse.json({ error: 'Dialogue not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
