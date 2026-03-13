/**
 * POST /api/chat/[roomId]/summarize
 *
 * 读取房间历史消息，调用 Claude API 生成对话摘要。
 * Response: { summary: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMessages, getRoomById } from '@/lib/chat-store';
import { getSettings, getProviderScopedApiKey } from '@/lib/settings-manager';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const { roomId } = await params;

    const room = await getRoomById(roomId);
    if (!room) {
      return NextResponse.json({ error: '房间不存在' }, { status: 404 });
    }

    const messages = await getMessages(roomId, 100);
    if (messages.length === 0) {
      return NextResponse.json({ summary: '暂无对话内容可供总结。' });
    }

    // 构建对话文本
    const transcript = messages
      .map(m => `[${new Date(m.createdAt).toLocaleTimeString('zh-CN')}] ${m.senderName}: ${m.content}`)
      .join('\n');

    // 获取 API Key
    const settings = await getSettings();
    const apiKey = getProviderScopedApiKey(settings.claude, 'anthropic');
    if (!apiKey) {
      return NextResponse.json(
        { error: '未配置 Anthropic API Key，请在设置页面填写后再使用 AI 总结功能。' },
        { status: 400 },
      );
    }

    // 调用 Anthropic Messages API
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `请对以下对话内容进行简洁的中文摘要，提炼出主要话题、关键决策和行动项（如有）。对话内容如下：\n\n${transcript}`,
          },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[chat/summarize] Anthropic API error:', errText);
      return NextResponse.json(
        { error: `AI 服务调用失败（${resp.status}）` },
        { status: 502 },
      );
    }

    const data = await resp.json();
    const summary: string =
      data?.content?.[0]?.type === 'text' ? data.content[0].text : '无法生成摘要。';

    return NextResponse.json({ summary });
  } catch (err) {
    console.error('[chat/summarize] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
