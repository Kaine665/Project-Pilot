import { NextRequest, NextResponse } from 'next/server';
import {
  getAgentChatSessionsPath,
  modifyJsonFile,
  readJsonFile,
} from '@/lib/file-store';
import { spawnClaude } from '@/lib/claude-cli';
import type { AgentChatSession, AgentChatSessionsData } from '@/types/agent-chat';

const DEFAULT_SESSIONS_DATA: AgentChatSessionsData = { sessions: [] };

/** 保留最后 N 条消息不参与压缩 */
const KEEP_RECENT_COUNT = 4;

/**
 * POST /api/agent-chat/sessions/[id]/compress
 *
 * Actions:
 *   - preview: 生成压缩预览（AI 摘要 + 保留的最后 4 条消息）
 *   - apply:   将压缩后的消息写回 session
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, '');

  if (!id) {
    return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = body.action;

  if (action === 'preview') {
    return handlePreview(id);
  }

  if (action === 'apply') {
    return handleApply(id, body);
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

// ── Preview ──

async function handlePreview(sessionId: string) {
  // 读取 session
  const data = await readJsonFile<AgentChatSessionsData>(
    getAgentChatSessionsPath(),
    DEFAULT_SESSIONS_DATA,
  );
  const session = data.sessions.find(s => s.id === sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const messages = session.messages;

  // 消息不够多，无需压缩
  if (messages.length <= KEEP_RECENT_COUNT) {
    return NextResponse.json(
      { error: '消息数量不足，无需压缩' },
      { status: 400 },
    );
  }

  const messagesToCompress = messages.slice(0, -KEEP_RECENT_COUNT);
  const recentMessages = messages.slice(-KEEP_RECENT_COUNT);

  // 调用 Claude CLI 生成摘要
  const prompt = `请将以下对话历史压缩为一段简洁的摘要。保留关键决策、结论和重要上下文，去除过程性细节。

<conversation>
${messagesToCompress.map(m => `[${m.role}]: ${m.content}`).join('\n\n')}
</conversation>

请直接输出摘要内容，不要加任何前缀或解释。摘要应该是第三人称叙述，概括对话的要点。`;

  try {
    // 用 stdin 传 prompt，避免 Windows 命令行长度限制
    // 用 stall 检测代替硬超时：每 30s 检查输出是否仍在增长
    const summary = await new Promise<string>((resolve, reject) => {
      const child = spawnClaude(['--print', '-p', '-'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDECODE: '' },
      });

      let stdout = '';
      let stderr = '';
      let prevLen = 0;
      let stallCount = 0;
      const MAX_STALLS = 2; // 连续 2 次无增长（~60s）才判定停滞

      const stallCheck = setInterval(() => {
        if (stdout.length === prevLen) {
          stallCount++;
          if (stallCount >= MAX_STALLS) {
            clearInterval(stallCheck);
            child.kill();
            // 停滞时返回已收集的输出，而非报错
            resolve(stdout.trim());
          }
        } else {
          stallCount = 0;
          prevLen = stdout.length;
        }
      }, 30000);

      child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
      child.on('error', (err) => { clearInterval(stallCheck); reject(err); });
      child.on('close', (code) => {
        clearInterval(stallCheck);
        // 非零退出但有输出时，仍返回已收集的内容
        if (code !== 0 && !stdout.trim()) {
          reject(new Error(`claude exited ${code}: ${stderr}`));
        } else {
          resolve(stdout.trim());
        }
      });

      child.stdin?.write(prompt);
      child.stdin?.end();
    });

    if (!summary) {
      return NextResponse.json(
        { error: 'AI 返回了空摘要' },
        { status: 500 },
      );
    }

    // 构建摘要消息
    const summaryMessage: AgentChatSession['messages'][number] = {
      role: 'assistant',
      content: `[会话摘要]\n${summary}`,
    };

    // 返回压缩后的消息列表（摘要 + 保留的最后 4 条）
    const compressedMessages = [
      { ...summaryMessage, id: `compress-summary-${Date.now()}`, timestamp: new Date().toISOString() },
      ...recentMessages,
    ];

    return NextResponse.json({ messages: compressedMessages });
  } catch (err) {
    console.error('[compress/preview] AI 摘要生成失败:', err);
    return NextResponse.json(
      { error: 'AI 摘要生成失败' },
      { status: 500 },
    );
  }
}

// ── Apply ──

async function handleApply(
  sessionId: string,
  body: Record<string, unknown>,
) {
  const messages = body.messages;

  if (!Array.isArray(messages)) {
    return NextResponse.json(
      { error: 'messages 字段必须是数组' },
      { status: 400 },
    );
  }

  try {
    await modifyJsonFile<AgentChatSessionsData>(
      getAgentChatSessionsPath(),
      DEFAULT_SESSIONS_DATA,
      (data) => {
        const idx = data.sessions.findIndex(s => s.id === sessionId);
        if (idx === -1) {
          throw new Error('SESSION_NOT_FOUND');
        }

        data.sessions[idx] = {
          ...data.sessions[idx],
          messages: messages as AgentChatSession['messages'],
          updatedAt: new Date().toISOString(),
        };

        return data;
      },
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'SESSION_NOT_FOUND') {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    console.error('[compress/apply] 写入失败:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
