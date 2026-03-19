import { NextRequest, NextResponse } from 'next/server';
import { buildPromptPreview } from '@/lib/agent-chat-manager';
import { getModelContextWindow } from '@/lib/provider-registry';
import { isValidProjectKey, isValidSessionId } from '@/lib/security';
import { getAgentById } from '@/lib/agents-store';
import { loadSession } from '@/lib/chat-managers/agent-chat-session-store';
import { getProviderScopedModel, getSettings } from '@/lib/settings-manager';

/**
 * GET /api/agent-chat/prompt-info?agentId=...&sessionId=...&projectKey=...&model=...
 *
 * 构建 Agent 完整系统提示词（不含用户消息），返回：
 * - charCount: 字符数
 * - estimatedTokens: 估算 token 数（CJK-aware：中文 ~1.5 chars/token，英文 ~4 chars/token）
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
    const settings = await getSettings();
    const [agent, session] = await Promise.all([
      getAgentById(agentId),
      sessionId ? loadSession(sessionId) : Promise.resolve(null),
    ]);
    const resolvedProvider =
      session?.config?.provider
      || agent?.defaultProvider
      || settings.claude.provider
      || 'anthropic';
    const resolvedModel =
      model.trim()
      || session?.config?.model
      || agent?.defaultModel
      || getProviderScopedModel(settings.claude, resolvedProvider);
    const contextWindow = getModelContextWindow(resolvedModel);

    return NextResponse.json({ charCount, estimatedTokens, contextWindow });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
