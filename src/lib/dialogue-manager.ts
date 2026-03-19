/**
 * Dialogue Manager — Agent 轮流对话核心逻辑
 *
 * 两个 Agent 围绕主题交替发言，通过 POST /api/agent-chat（sidecar）启动每轮会话，
 * 轮询 GET /agent-chat/status 等待完成，提取回复后存入对话记录。
 *
 * 每条消息写入后立即持久化，支持断点恢复。
 * SSE 通过 EventEmitter 广播给前端。
 */

import { EventEmitter } from 'events';
import {
  getDialoguesIndexPath,
  getDialoguePath,
  getDialoguesDir,
  readJsonFile,
  writeJsonFile,
} from '@/lib/file-store';
import { sidecarFetch } from '@/lib/sidecar-bridge';
import { generateSessionId } from '@/lib/chat-managers/agent-chat-manager';
import { loadSession } from '@/lib/chat-managers/agent-chat-session-store';
import type {
  AgentDialogue,
  AgentDialogueSummary,
  DialogueMessage,
  DialoguesIndexData,
  DialogueStatus,
  DialogueTerminationMode,
} from '@/types';
import { promises as fs } from 'fs';

// ── SSE Event Bus ──

export interface DialogueSSEEvent {
  type: 'message' | 'status' | 'error' | 'done';
  data: unknown;
}

/**
 * 全局事件总线，每个 dialogue ID 对应一个 channel。
 * 前端 SSE 路由监听 `dialogue:{id}` 事件。
 */
export const dialogueEvents = new EventEmitter();
dialogueEvents.setMaxListeners(50);

function emitSSE(dialogueId: string, event: DialogueSSEEvent): void {
  dialogueEvents.emit(`dialogue:${dialogueId}`, event);
}

// ── Stop signal registry ──

const stopSignals = new Set<string>();

// ── CRUD ──

export interface CreateDialogueParams {
  title: string;
  description?: string;
  agentA: { id: string; name: string };
  agentB: { id: string; name: string };
  maxRounds?: number;
  terminationMode?: DialogueTerminationMode;
  projectKey?: string;
}

export async function createDialogue(params: CreateDialogueParams): Promise<AgentDialogue> {
  const id = `dialogue-${Date.now()}`;
  const dialogue: AgentDialogue = {
    id,
    title: params.title,
    description: params.description,
    agentA: params.agentA,
    agentB: params.agentB,
    status: 'pending',
    maxRounds: params.maxRounds ?? 10,
    currentRound: 0,
    terminationMode: params.terminationMode ?? 'max_rounds',
    messages: [],
    projectKey: params.projectKey,
    createdAt: new Date().toISOString(),
  };

  // 确保目录存在
  await fs.mkdir(getDialoguesDir(), { recursive: true });

  // 保存完整对话
  await writeJsonFile(getDialoguePath(id), dialogue);

  // 更新索引
  await updateIndex(dialogue);

  return dialogue;
}

export async function getDialogue(dialogueId: string): Promise<AgentDialogue | null> {
  try {
    const data = await readJsonFile<AgentDialogue | null>(getDialoguePath(dialogueId), null);
    return data;
  } catch {
    return null;
  }
}

export async function listDialogues(): Promise<AgentDialogueSummary[]> {
  const data = await readJsonFile<DialoguesIndexData>(getDialoguesIndexPath(), { dialogues: [] });
  return data.dialogues;
}

export async function deleteDialogue(dialogueId: string): Promise<boolean> {
  try {
    await fs.unlink(getDialoguePath(dialogueId)).catch(() => {});

    // 从索引中删除
    const indexData = await readJsonFile<DialoguesIndexData>(getDialoguesIndexPath(), { dialogues: [] });
    indexData.dialogues = indexData.dialogues.filter(d => d.id !== dialogueId);
    await writeJsonFile(getDialoguesIndexPath(), indexData);

    return true;
  } catch {
    return false;
  }
}

// ── Run / Stop ──

export async function stopDialogue(dialogueId: string): Promise<boolean> {
  stopSignals.add(dialogueId);
  const dialogue = await getDialogue(dialogueId);
  if (!dialogue || dialogue.status !== 'running') return false;

  dialogue.status = 'stopped';
  dialogue.completedAt = new Date().toISOString();
  await saveDialogue(dialogue);
  emitSSE(dialogueId, { type: 'status', data: { status: 'stopped', currentRound: dialogue.currentRound } });
  emitSSE(dialogueId, { type: 'done', data: {} });
  return true;
}

/**
 * 执行对话：交替调用两个 Agent，直到满足终止条件。
 * 此函数在后台运行（fire-and-forget），不阻塞 API 请求。
 */
export async function runDialogue(dialogueId: string): Promise<void> {
  const dialogue = await getDialogue(dialogueId);
  if (!dialogue) throw new Error(`Dialogue not found: ${dialogueId}`);

  dialogue.status = 'running';
  await saveDialogue(dialogue);
  emitSSE(dialogueId, { type: 'status', data: { status: 'running', currentRound: dialogue.currentRound } });

  try {
    for (let round = dialogue.currentRound + 1; round <= dialogue.maxRounds; round++) {
      // 检查停止信号
      if (stopSignals.has(dialogueId)) {
        stopSignals.delete(dialogueId);
        return;
      }

      // AgentA 发言
      const replyA = await callAgentForDialogue(dialogue, 'agentA', round);
      dialogue.messages.push(replyA);
      dialogue.currentRound = round;
      await saveDialogue(dialogue);
      emitSSE(dialogueId, { type: 'message', data: replyA });

      // 检查 consensus
      if (replyA.content.includes('[CONSENSUS]')) {
        dialogue.status = 'completed';
        break;
      }

      // 检查停止信号
      if (stopSignals.has(dialogueId)) {
        stopSignals.delete(dialogueId);
        return;
      }

      // AgentB 发言
      const replyB = await callAgentForDialogue(dialogue, 'agentB', round);
      dialogue.messages.push(replyB);
      await saveDialogue(dialogue);
      emitSSE(dialogueId, { type: 'message', data: replyB });

      // 检查 consensus
      if (replyB.content.includes('[CONSENSUS]')) {
        dialogue.status = 'completed';
        break;
      }
    }

    if (dialogue.status === 'running') {
      dialogue.status = 'completed'; // 轮数耗尽
    }
    dialogue.completedAt = new Date().toISOString();
    await saveDialogue(dialogue);
    emitSSE(dialogueId, { type: 'status', data: { status: dialogue.status, currentRound: dialogue.currentRound } });
    emitSSE(dialogueId, { type: 'done', data: {} });
  } catch (err) {
    dialogue.status = 'error';
    dialogue.error = (err as Error).message;
    dialogue.completedAt = new Date().toISOString();
    await saveDialogue(dialogue);
    emitSSE(dialogueId, { type: 'error', data: { error: dialogue.error } });
    emitSSE(dialogueId, { type: 'done', data: {} });
  } finally {
    stopSignals.delete(dialogueId);
  }
}

// ── Internal helpers ──

function formatDialogueHistory(messages: DialogueMessage[]): string {
  if (messages.length === 0) return '';
  return messages.map(m => {
    const label = m.speaker === 'agentA' ? 'A' : 'B';
    return `**[${label} - R${m.round}]**: ${m.content}`;
  }).join('\n\n---\n\n');
}

async function callAgentForDialogue(
  dialogue: AgentDialogue,
  speaker: 'agentA' | 'agentB',
  round: number,
): Promise<DialogueMessage> {
  const agent = dialogue[speaker];
  const otherAgent = speaker === 'agentA' ? dialogue.agentB : dialogue.agentA;

  // 构建消息
  const historyText = formatDialogueHistory(dialogue.messages);
  const instruction = round === 1 && speaker === 'agentA'
    ? '你先发言。'
    : '请回复。';

  const message = [
    '## 对话模式',
    `你正在与 **${otherAgent.name}** 进行轮流对话。`,
    `主题：${dialogue.title}`,
    dialogue.description ? `背景：${dialogue.description}` : '',
    `当前轮次：${round}/${dialogue.maxRounds}`,
    '',
    '### 规则',
    '1. 直接回复对方的观点，不要重复寒暄',
    '2. 如果你们达成共识，在回复末尾加上 [CONSENSUS]',
    '3. 保持你自己的专业视角，不要无原则附和',
    '4. 回复控制在 500 字以内，言简意赅',
    '',
    historyText ? `### 对话历史\n${historyText}\n` : '',
    instruction,
  ].filter(Boolean).join('\n');

  const sessionId = generateSessionId();

  // 通过 sidecar 启动会话
  const startRes = await sidecarFetch('/agent-chat/start', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      agentId: agent.id,
      message,
      flowContext: dialogue.projectKey ? {
        projectKey: dialogue.projectKey,
        projectName: dialogue.projectKey,
        flowDataPath: '',
      } : undefined,
      initialTitle: `[Dialogue R${round}] ${dialogue.title}`,
      background: true,
    }),
  });

  if (!startRes.ok) {
    const err = await startRes.text();
    throw new Error(`Failed to start agent session for ${speaker}: ${err}`);
  }

  // 轮询等待完成
  const reply = await waitForSessionComplete(sessionId);

  return {
    round,
    speaker,
    agentId: agent.id,
    content: reply,
    sessionId,
    timestamp: new Date().toISOString(),
  };
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max per turn

async function waitForSessionComplete(sessionId: string): Promise<string> {
  const start = Date.now();

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);

    const res = await sidecarFetch(
      `/agent-chat/status?sessionId=${encodeURIComponent(sessionId)}`,
    );
    if (!res.ok) continue;

    const data = await res.json() as {
      status: string;
      messages?: Array<{ role: string; content: string }>;
    };

    if (data.status === 'running' || data.status === 'awaiting') {
      continue;
    }

    if (data.status === 'failed' || data.status === 'stopped') {
      throw new Error(`Agent session ${data.status}: ${sessionId}`);
    }

    if (data.status === 'completed' || data.status === 'none') {
      // 尝试从内存消息中提取
      const messages = data.messages ?? [];
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
      if (lastAssistant?.content) {
        return lastAssistant.content;
      }

      // 回退到磁盘读取（直接调用 store 函数，不走 HTTP）
      const session = await loadSession(sessionId);
      if (session?.messages) {
        const diskAssistant = [...session.messages].reverse().find(m => m.role === 'assistant');
        if (diskAssistant?.content) {
          return typeof diskAssistant.content === 'string'
            ? diskAssistant.content
            : JSON.stringify(diskAssistant.content);
        }
      }

      // 如果 status 是 none 且没有消息，可能还没开始，继续等
      if (data.status === 'none' && messages.length === 0) {
        continue;
      }

      return '(No response)';
    }
  }

  throw new Error(`Timeout waiting for session ${sessionId} to complete`);
}

async function saveDialogue(dialogue: AgentDialogue): Promise<void> {
  await writeJsonFile(getDialoguePath(dialogue.id), dialogue);
  await updateIndex(dialogue);
}

async function updateIndex(dialogue: AgentDialogue): Promise<void> {
  const indexData = await readJsonFile<DialoguesIndexData>(getDialoguesIndexPath(), { dialogues: [] });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { messages: _, ...summary } = dialogue;

  const idx = indexData.dialogues.findIndex(d => d.id === dialogue.id);
  if (idx >= 0) {
    indexData.dialogues[idx] = summary;
  } else {
    indexData.dialogues.unshift(summary);
  }

  await writeJsonFile(getDialoguesIndexPath(), indexData);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
