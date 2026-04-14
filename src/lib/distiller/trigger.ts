/**
 * Distiller v0 — 监听 session_completed，节流后读消息并串联 extract + persist。
 */

import type { ChangeEvent } from '@/lib/change-emitter';
import { readMessages } from '@/lib/chat-managers/agent-chat-session-store';
import { getSettings } from '@/lib/settings-manager';
import { extractDistillerOutput } from './extract';
import { persistDistillerOutput } from './persist';
import type { DistillerInput } from './types';

const MIN_MESSAGES = 4;
const POST_PERSIST_DELAY_MS = 2000;
const LOG_PREFIX = '[Distiller]';

function messageToPlainContent(content: string): string {
  return content?.trim() ?? '';
}

export async function handleSessionCompleted(event: ChangeEvent): Promise<void> {
  if (event.type !== 'session_completed') return;

  const sessionId = event.sourceId;
  if (!sessionId) return;

  await new Promise((r) => setTimeout(r, POST_PERSIST_DELAY_MS));

  try {
    const settings = await getSettings();
    if (settings.distiller?.enabled === false) {
      return;
    }

    const messages = await readMessages(sessionId);
    if (messages.length < MIN_MESSAGES) {
      console.log(
        `${LOG_PREFIX} skip sessionId=${sessionId}: only ${messages.length} messages (< ${MIN_MESSAGES})`,
      );
      return;
    }

    const simplified = messages.map((m) => ({
      role: m.role,
      content: messageToPlainContent(m.content),
    }));

    const input: DistillerInput = {
      sessionId,
      agentId: event.agentId ?? 'unknown',
      projectKey: event.projectKey,
      messages: simplified,
    };

    const { output } = await extractDistillerOutput(settings, input);
    await persistDistillerOutput(input, output);
  } catch (err) {
    console.error(`${LOG_PREFIX} handleSessionCompleted error:`, err);
  }
}
