/**
 * POST /api/distiller/run — 手动触发 Distiller 提炼。
 *
 * Body:
 *   { sessionId: string }
 *
 * 返回提炼结果 JSON（同时落盘到 documents + todos）。
 */

import { Hono } from 'hono';
import { readMessages, loadSession } from '@/lib/chat-managers/agent-chat-session-store';
import { getSettings } from '@/lib/settings-manager';
import { extractDistillerOutput } from '@/lib/distiller/extract';
import { persistDistillerOutput } from '@/lib/distiller/persist';
import type { DistillerInput } from '@/lib/distiller/types';
import type { ProviderId } from '@/types';
import { HttpError } from '@/lib/http-error';

const app = new Hono();

async function runDistiller(sessionId: string) {
  const sid = sessionId.trim();
  const [messages, session, settings] = await Promise.all([
    readMessages(sid),
    loadSession(sid),
    getSettings(),
  ]);
  if (messages.length === 0) {
    throw new HttpError(`session ${sid} has no messages`, 404);
  }

  const simplified = messages.map((m) => ({
    role: m.role,
    content: m.content?.trim() ?? '',
  }));

  const sessionProvider = session?.config?.provider as ProviderId | undefined;
  const sessionModel = session?.config?.model;
  console.log(`[Distiller] route: sessionId=${sid} sessionProvider=${sessionProvider} sessionModel=${sessionModel} configKeys=${JSON.stringify(Object.keys(session?.config ?? {}))}`);

  const input: DistillerInput = {
    sessionId: sid,
    agentId: 'manual',
    projectKey: session?.projectKey,
    messages: simplified,
  };

  const { output, diagnostic } = await extractDistillerOutput(settings, input, {
    sessionProvider,
    sessionModel,
  });
  await persistDistillerOutput(input, output);
  return { ok: true, ...output, diagnostic };
}

app.post('/run', async (c) => {
  const { sessionId } = await c.req.json<{ sessionId?: string }>();
  if (!sessionId?.trim()) throw new HttpError('sessionId is required', 400);
  return c.json(await runDistiller(sessionId));
});

app.get('/run', async (c) => {
  const sessionId = c.req.query('sessionId');
  if (!sessionId?.trim()) throw new HttpError('sessionId query param is required', 400);
  return c.json(await runDistiller(sessionId));
});

export default app;
