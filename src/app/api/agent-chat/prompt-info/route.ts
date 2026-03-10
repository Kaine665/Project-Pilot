import { NextRequest, NextResponse } from 'next/server';
import { buildPromptPreview } from '@/lib/agent-chat-manager';
import { getModelContextWindow } from '@/lib/provider-registry';
import { isValidProjectKey, isValidSessionId } from '@/lib/security';

/**
 * GET /api/agent-chat/prompt-info?agentId=...&sessionId=...&projectKey=...&model=...
 *
 * 构建 Agent 完整系统提示词（不含用户消息），返回：
 * - charCount: 字符数
 * - estimatedTokens: 估算 token 数（chars / 3.5）
 * - contextWindow: 当前模型的上下文窗口大小（token）
 *
 * 用于在 UI 中展示"提示词占用量"和"上下文窗口圆环"。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const agentId = searchParams.get('agentId');
  const sessionId = searchParams.get('sessionId') ?? undefined;
  const projectKey = searchParams.get('projectKey') ?? undefined;
  const model = searchParams.get('model') ?? '';

  if (!agentId) {
    return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
  }

  if (sessionId && !isValidSessionId(sessionId)) {
    return NextResponse.json({ error: 'Invalid sessionId format' }, { status: 400 });
  }

  if (projectKey && !isValidProjectKey(projectKey)) {
    return NextResponse.json({ error: 'Invalid projectKey format' }, { status: 400 });
  }

  try {
    const { charCount, estimatedTokens } = await buildPromptPreview(agentId, sessionId, projectKey);
    const contextWindow = getModelContextWindow(model || 'claude-sonnet-4-6');

    return NextResponse.json({ charCount, estimatedTokens, contextWindow });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
