import { NextRequest, NextResponse } from 'next/server';
import { createDialogue, listDialogues, runDialogue } from '@/lib/dialogue-manager';
import type { DialogueTerminationMode } from '@/types';

/**
 * GET /api/dialogues — 列出所有对话（轻量索引，不含 messages）
 */
export async function GET() {
  try {
    const dialogues = await listDialogues();
    return NextResponse.json({ dialogues });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/dialogues — 创建并启动对话
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, agentA, agentB, maxRounds, terminationMode, projectKey } = body as {
      title: string;
      description?: string;
      agentA: { id: string; name: string };
      agentB: { id: string; name: string };
      maxRounds?: number;
      terminationMode?: DialogueTerminationMode;
      projectKey?: string;
    };

    // Validation
    if (!title || typeof title !== 'string' || title.length > 500) {
      return NextResponse.json({ error: 'title is required (max 500 chars)' }, { status: 400 });
    }
    if (!agentA?.id || !agentA?.name || !agentB?.id || !agentB?.name) {
      return NextResponse.json({ error: 'agentA and agentB with id and name are required' }, { status: 400 });
    }
    if (maxRounds !== undefined && (typeof maxRounds !== 'number' || maxRounds < 1 || maxRounds > 50)) {
      return NextResponse.json({ error: 'maxRounds must be 1-50' }, { status: 400 });
    }

    const dialogue = await createDialogue({
      title,
      description,
      agentA,
      agentB,
      maxRounds,
      terminationMode,
      projectKey,
    });

    // 后台启动对话（fire-and-forget）
    runDialogue(dialogue.id).catch(err => {
      console.error(`[dialogue] runDialogue failed for ${dialogue.id}:`, err);
    });

    return NextResponse.json(dialogue, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
