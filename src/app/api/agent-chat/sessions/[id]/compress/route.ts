import { NextRequest, NextResponse } from 'next/server';
import { spawnClaude } from '@/lib/claude-cli';
import {
  loadSession,
  readMessages,
  replaceSessionMessages,
} from '@/lib/chat-managers/agent-chat-session-store';
import type { AgentChatSession, ChatMessage } from '@/types/agent-chat';

/** Keep last N messages out of compression */
const KEEP_RECENT_COUNT = 4;

/**
 * POST /api/agent-chat/sessions/[id]/compress
 *
 * Actions:
 *   - preview: AI summary + last 4 messages
 *   - apply:   write compressed messages back to session
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
  const messages = await readMessages(sessionId);

  if (messages.length === 0) {
    return NextResponse.json({ error: 'Session not found or empty' }, { status: 404 });
  }

  if (messages.length <= KEEP_RECENT_COUNT) {
    return NextResponse.json(
      { error: '\u6D88\u606F\u6570\u91CF\u4E0D\u8DB3\uFF0C\u65E0\u9700\u538B\u7F29' },
      { status: 400 },
    );
  }

  const messagesToCompress = messages.slice(0, -KEEP_RECENT_COUNT);
  const recentMessages = messages.slice(-KEEP_RECENT_COUNT);

  const prompt = `\u8BF7\u5C06\u4EE5\u4E0B\u5BF9\u8BDD\u5386\u53F2\u538B\u7F29\u4E3A\u4E00\u6BB5\u7B80\u6D01\u7684\u6458\u8981\u3002\u4FDD\u7559\u5173\u952E\u51B3\u7B56\u3001\u7ED3\u8BBA\u548C\u91CD\u8981\u4E0A\u4E0B\u6587\uFF0C\u53BB\u9664\u8FC7\u7A0B\u6027\u7EC6\u8282\u3002

<conversation>
${messagesToCompress.map(m => `[${m.role}]: ${m.content}`).join('\n\n')}
</conversation>

\u8BF7\u76F4\u63A5\u8F93\u51FA\u6458\u8981\u5185\u5BB9\uFF0C\u4E0D\u8981\u52A0\u4EFB\u4F55\u524D\u7F00\u6216\u89E3\u91CA\u3002\u6458\u8981\u5E94\u8BE5\u662F\u7B2C\u4E09\u4EBA\u79F0\u53D9\u8FF0\uFF0C\u6982\u62EC\u5BF9\u8BDD\u7684\u8981\u70B9\u3002`;

  try {
    const summary = await new Promise<string>((resolve, reject) => {
      const child = spawnClaude(['--print', '-p', '-'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDECODE: '' },
      });

      let stdout = '';
      let stderr = '';
      let prevLen = 0;
      let stallCount = 0;
      const MAX_STALLS = 2;

      const stallCheck = setInterval(() => {
        if (stdout.length === prevLen) {
          stallCount++;
          if (stallCount >= MAX_STALLS) {
            clearInterval(stallCheck);
            child.kill();
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
        { error: 'AI \u8FD4\u56DE\u4E86\u7A7A\u6458\u8981' },
        { status: 500 },
      );
    }

    const summaryMessage: AgentChatSession['messages'][number] = {
      role: 'assistant',
      content: `[\u4F1A\u8BDD\u6458\u8981]\n${summary}`,
    };

    const compressedMessages = [
      { ...summaryMessage, id: `compress-summary-${Date.now()}`, timestamp: new Date().toISOString() },
      ...recentMessages,
    ];

    return NextResponse.json({ messages: compressedMessages });
  } catch (err) {
    console.error('[compress/preview] AI \u6458\u8981\u751F\u6210\u5931\u8D25:', err);
    return NextResponse.json(
      { error: 'AI \u6458\u8981\u751F\u6210\u5931\u8D25' },
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
      { error: 'messages \u5B57\u6BB5\u5FC5\u987B\u662F\u6570\u7EC4' },
      { status: 400 },
    );
  }

  try {
    const found = await replaceSessionMessages(sessionId, messages as ChatMessage[]);
    if (!found) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[compress/apply] \u5199\u5165\u5931\u8D25:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
