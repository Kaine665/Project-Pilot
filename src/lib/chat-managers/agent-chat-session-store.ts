/**
 * Agent Chat Session Store — JSONL-backed message storage (v2).
 *
 * Architecture:
 *   - Index file (agent-chat-sessions.json): lightweight metadata per session (no messages)
 *   - Message files (agent-chat-messages/{sessionId}.jsonl): one JSON line per message
 *
 * Benefits over the v1 monolithic JSON:
 *   - Appending a message is O(1) (appendFileSync), not O(total-messages) rewrite
 *   - Index file stays small (~100 bytes per session), fast to parse
 *   - Crash during write loses at most one message, not the entire file
 *   - Individual sessions can be deleted/archived without rewriting all others
 *
 * Backward compatibility:
 *   - On first read, auto-migrates old format (sessions with embedded messages)
 *     by extracting messages to JSONL files and stripping them from the index.
 *
 * API routes should import these functions directly, not via agentChatManager singleton.
 */

import { promises as fs } from 'fs';
import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import {
  getAgentChatSessionsPath,
  getAgentChatSessionAdjunctsPath,
  getAgentChatMessagesDir,
  getAgentChatMessagePath,
  getAgentsPath,
  readJsonFile,
  modifyJsonFile,
  parseJsonSafe,
} from '@/lib/file-store';
import { deleteRuntimePromptCopy } from '@/lib/agent-prompt-store';
import { looksLikeCorruptedStoredText, repairStoredTextIfNeeded } from '@/lib/text-repair-server';
import type { Agent, AgentsData, ContentBlock } from '@/types';
import type {
  AgentChatSession,
  AgentChatSessionsData,
  ChatMessage,
  DeferredInputBufferState,
  SessionConfig,
  SessionMeta,
} from '@/types/agent-chat';
import { getDefaultAgents } from '@/lib/default-agents';
import type { SessionExecution } from './types';

// ── Constants ──

const DEFAULT_SESSIONS_DATA: AgentChatSessionsData = { sessions: [] };
const DEFAULT_ADJUNCTS_DATA: AgentChatSessionAdjunctsData = { sessions: {} };

interface LegacyAwaitingSubAgents {
  sessionIds: string[];
  registeredAt: number;
  timeoutMs: number;
}

interface LegacySessionExecution extends Partial<SessionExecution> {
  awaitingSubAgents?: LegacyAwaitingSubAgents;
}

interface LegacySessionMeta extends Omit<SessionMeta, 'execution'> {
  pendingUserQueue?: DeferredInputBufferState;
  background?: boolean;
  depth?: number;
  execution?: LegacySessionExecution;
}

interface LegacyAgentChatSessionsData {
  sessions: LegacySessionMeta[];
}

interface AgentChatSessionAdjunctEntry {
  deferredInputBuffer?: DeferredInputBufferState;
}

interface AgentChatSessionAdjunctsData {
  sessions: Record<string, AgentChatSessionAdjunctEntry>;
}

// ── Migration flag ──
let _migrationDone = false;
let _indexNormalized = false;

// ── Sessions index cache (reduce repeated full-file reads) ──
// Now the index is much smaller (no messages), so caching is even more effective.
let _indexCache: AgentChatSessionsData | null = null;
let _indexCacheTs = 0;
const INDEX_CACHE_TTL = 500; // 500ms

function cloneDeferredInputBuffer(
  queue?: DeferredInputBufferState,
): DeferredInputBufferState | undefined {
  if (!queue || queue.items.length === 0) return undefined;
  return {
    items: queue.items.map((item) => ({
      text: item.text,
      images: item.images?.length ? [...item.images] : undefined,
    })),
    expanded: queue.expanded,
  };
}

function sanitizeExecution(
  sessionId: string,
  execution?: LegacySessionExecution,
): SessionExecution | undefined {
  if (!execution || !execution.status || !execution.startedAt) {
    return undefined;
  }

  const awaiting = execution.awaiting ?? (
    execution.awaitingSubAgents
      ? {
          waiting: true as const,
          subAgentSessionIds: [...execution.awaitingSubAgents.sessionIds],
          registeredAt: execution.awaitingSubAgents.registeredAt,
          timeoutMs: execution.awaitingSubAgents.timeoutMs,
        }
      : undefined
  );

  return {
    runId: execution.runId ?? `persisted-${sessionId}`,
    status: execution.status,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt ?? execution.startedAt,
    errorMessage: repairStoredTextIfNeeded(execution.errorMessage),
    stopReason: execution.stopReason,
    resultSummary: execution.resultSummary ?? execution.result?.summary,
    result: execution.result,
    tokenUsage: execution.tokenUsage,
    eventCount: execution.eventCount ?? 0,
    awaiting,
  };
}

function sanitizeSessionMeta(meta: LegacySessionMeta): SessionMeta {
  const repairedTitle = repairStoredTextIfNeeded(meta.title) ?? meta.title;
  const normalized: SessionMeta = {
    id: meta.id,
    agentId: meta.agentId,
    projectKey: meta.projectKey,
    title: repairedTitle,
    claudeSessionId: meta.claudeSessionId,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    unreadCount: meta.unreadCount,
    archived: meta.archived,
    config: meta.config,
    guardRetryCount: meta.guardRetryCount,
    parentSessionId: meta.parentSessionId,
    importedTurnIndices: meta.importedTurnIndices,
    checkpoint: meta.checkpoint,
    messageCount: meta.messageCount,
  };

  const execution = sanitizeExecution(meta.id, meta.execution);
  if (execution) {
    normalized.execution = execution;
  }

  return normalized;
}

function needsSessionNormalization(meta: LegacySessionMeta): boolean {
  return Boolean(
    looksLikeCorruptedStoredText(meta.title)
      || looksLikeCorruptedStoredText(meta.execution?.errorMessage)
      || meta.pendingUserQueue
      || meta.background !== undefined
      || meta.depth !== undefined
      || meta.execution?.awaitingSubAgents,
  );
}

async function normalizeIndexIfNeeded(): Promise<void> {
  if (_indexNormalized) return;

  const raw = await readJsonFile<LegacyAgentChatSessionsData>(
    getAgentChatSessionsPath(),
    DEFAULT_SESSIONS_DATA,
  );

  const deferredInputBufferBySession: Record<string, AgentChatSessionAdjunctEntry> = {};
  let changed = false;

  const normalizedSessions = raw.sessions.map((session) => {
    const deferredInputBuffer = cloneDeferredInputBuffer(session.pendingUserQueue);
    if (deferredInputBuffer) {
      deferredInputBufferBySession[session.id] = { deferredInputBuffer };
      changed = true;
    }
    if (needsSessionNormalization(session)) {
      changed = true;
    }
    return sanitizeSessionMeta(session);
  });

  if (Object.keys(deferredInputBufferBySession).length > 0) {
    await modifyJsonFile<AgentChatSessionAdjunctsData>(
      getAgentChatSessionAdjunctsPath(),
      DEFAULT_ADJUNCTS_DATA,
      (data) => {
        for (const [sessionId, entry] of Object.entries(deferredInputBufferBySession)) {
          const existing = data.sessions[sessionId]?.deferredInputBuffer;
          if (!existing && entry.deferredInputBuffer) {
            data.sessions[sessionId] = { deferredInputBuffer: entry.deferredInputBuffer };
          }
        }
        return data;
      },
    );
  }

  if (changed) {
    await modifyJsonFile<AgentChatSessionsData>(
      getAgentChatSessionsPath(),
      DEFAULT_SESSIONS_DATA,
      () => ({ sessions: normalizedSessions }),
    );
    invalidateIndexCache();
  }

  _indexNormalized = true;
}

async function getIndexData(): Promise<AgentChatSessionsData> {
  // Ensure migration has run at least once
  if (!_migrationDone) {
    await migrateIfNeeded();
  }
  if (!_indexNormalized) {
    await normalizeIndexIfNeeded();
  }

  const now = Date.now();
  if (_indexCache && now - _indexCacheTs < INDEX_CACHE_TTL) {
    return _indexCache;
  }
  _indexCache = await readJsonFile<AgentChatSessionsData>(
    getAgentChatSessionsPath(),
    DEFAULT_SESSIONS_DATA,
  );
  _indexCacheTs = now;
  return _indexCache;
}

function invalidateIndexCache(): void {
  _indexCache = null;
  _indexCacheTs = 0;
  _indexNormalized = false;
}

async function getAdjunctData(): Promise<AgentChatSessionAdjunctsData> {
  return readJsonFile<AgentChatSessionAdjunctsData>(
    getAgentChatSessionAdjunctsPath(),
    DEFAULT_ADJUNCTS_DATA,
  );
}

// ── JSONL Message I/O ──

/**
 * Read all messages for a session from its JSONL file.
 * Returns empty array if the file doesn't exist.
 */
export async function readMessages(sessionId: string): Promise<ChatMessage[]> {
  const filePath = getAgentChatMessagePath(sessionId);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const messages: ChatMessage[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        messages.push(parseJsonSafe<ChatMessage>(trimmed));
      } catch {
        // Skip malformed lines (partial write from crash)
        console.warn(`[readMessages] Skipping malformed line in ${sessionId}`);
      }
    }
    return messages;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * Append multiple messages to the session's JSONL file.
 */
function appendMessages(sessionId: string, messages: ChatMessage[]): void {
  if (messages.length === 0) return;
  const filePath = getAgentChatMessagePath(sessionId);
  const dir = getAgentChatMessagesDir();
  try {
    mkdirSync(dir, { recursive: true });
  } catch { /* already exists */ }
  const lines = messages.map(m => JSON.stringify(m)).join('\n') + '\n';
  appendFileSync(filePath, lines, 'utf-8');
}

/**
 * Overwrite all messages for a session (used by branch, compress, migration).
 * Atomic: write to tmp then rename.
 */
async function writeAllMessages(sessionId: string, messages: ChatMessage[]): Promise<void> {
  const filePath = getAgentChatMessagePath(sessionId);
  const dir = getAgentChatMessagesDir();
  await fs.mkdir(dir, { recursive: true });
  const content = messages.map(m => JSON.stringify(m)).join('\n') + (messages.length ? '\n' : '');
  const tmpPath = filePath + `.tmp_${Date.now()}`;
  await fs.writeFile(tmpPath, content, 'utf-8');
  try {
    await fs.rename(tmpPath, filePath);
  } catch {
    // Windows fallback: copy + unlink
    await fs.copyFile(tmpPath, filePath);
    await fs.unlink(tmpPath).catch(() => {});
  }
}

/**
 * Delete the JSONL file for a session.
 */
async function deleteMessageFile(sessionId: string): Promise<void> {
  const filePath = getAgentChatMessagePath(sessionId);
  await fs.unlink(filePath).catch(() => {});
}

async function deleteSessionAdjuncts(sessionId: string): Promise<void> {
  await modifyJsonFile<AgentChatSessionAdjunctsData>(
    getAgentChatSessionAdjunctsPath(),
    DEFAULT_ADJUNCTS_DATA,
    (data) => {
      delete data.sessions[sessionId];
      return data;
    },
  );
}

// ── Streaming Draft (crash recovery) ──

/**
 * Get the path for a session's streaming draft file.
 * The draft stores partial raw assistant text while a stream is active.
 * If the server crashes mid-stream, loadSession() recovers the partial text on next read.
 */
function getStreamingDraftPath(sessionId: string): string {
  return path.join(getAgentChatMessagesDir(), `${sessionId}.streaming.json`);
}

/**
 * Overwrite the streaming draft for a session with the latest accumulated text.
 * Exported so AgentChatManager can call it during streaming (fire-and-forget).
 */
export async function writeStreamingDraft(sessionId: string, text: string): Promise<void> {
  const draftPath = getStreamingDraftPath(sessionId);
  const dir = getAgentChatMessagesDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(draftPath, JSON.stringify({ text, ts: Date.now() }), 'utf-8');
}

/**
 * Delete the streaming draft file. Safe to call even if the file doesn't exist.
 * Exported so AgentChatManager can call it after a run completes normally.
 */
export async function deleteStreamingDraft(sessionId: string): Promise<void> {
  await fs.unlink(getStreamingDraftPath(sessionId)).catch(() => {});
}

/**
 * Strip known ProjectPilot action tags from raw streaming text.
 * Called during crash recovery to avoid exposing internal XML tags to the user.
 * Only handles the statically known tag set — new tag types remain visible as raw text,
 * which is acceptable since crash recovery is an exceptional path.
 */
function stripActionTags(text: string): string {
  return text
    .replace(/<save-doc[^>]*>[\s\S]*?<\/save-doc>/g, '')
    .replace(/<save-knowledge[^>]*>[\s\S]*?<\/save-knowledge>/g, '')
    .replace(/<suspend-task[^>]*>[\s\S]*?<\/suspend-task>/g, '')
    .replace(/<complete-suspended-task[^>]*/g, '')
    .trim();
}

// ── Auto-migration from v1 (monolithic) to v2 (index + JSONL) ──

async function migrateIfNeeded(): Promise<void> {
  _migrationDone = true; // Set early to prevent re-entry

  const data = await readJsonFile<{ sessions: Array<SessionMeta & { messages?: ChatMessage[] }> }>(
    getAgentChatSessionsPath(),
    { sessions: [] },
  );

  // Check if any session still has embedded messages
  const sessionsWithMessages = data.sessions.filter(
    s => Array.isArray(s.messages) && s.messages.length > 0,
  );

  if (sessionsWithMessages.length === 0) {
    return; // Already migrated or fresh install
  }

  console.log(`[session-store] Migrating ${sessionsWithMessages.length} sessions from v1 (monolithic) to v2 (JSONL)...`);

  // Ensure messages directory exists
  await fs.mkdir(getAgentChatMessagesDir(), { recursive: true });

  // Extract messages to JSONL files
  for (const session of sessionsWithMessages) {
    if (session.messages && session.messages.length > 0) {
      await writeAllMessages(session.id, session.messages);
      // Update messageCount for the index
      session.messageCount = session.messages.length;
    }
  }

  // Strip messages from index and write back
  const cleanedSessions: SessionMeta[] = data.sessions.map(s => {
    const { messages, ...meta } = s;
    return {
      ...meta,
      messageCount: meta.messageCount ?? (Array.isArray(messages) ? messages.length : 0),
    };
  });

  await modifyJsonFile<AgentChatSessionsData>(
    getAgentChatSessionsPath(),
    DEFAULT_SESSIONS_DATA,
    () => ({ sessions: cleanedSessions }),
  );

  invalidateIndexCache();
  console.log(`[session-store] Migration complete. ${sessionsWithMessages.length} sessions extracted to JSONL.`);
}

// ── ID Generation ──

export function generateSessionId(): string {
  return `agent-chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── Session Read Operations ──

/** Test connection sessions (__test-*) are ephemeral, excluded from listings */
const isEphemeralTestSession = (id: string) => id.startsWith('__test-');

/**
 * Load a full session (metadata + messages from JSONL).
 * Returns null if the session doesn't exist in the index.
 */
export async function loadSession(sessionId: string): Promise<AgentChatSession | null> {
  const data = await getIndexData();
  const meta = data.sessions.find(s => s.id === sessionId);
  if (!meta) return null;

  const messages = await readMessages(sessionId);

  // Crash recovery: check for leftover streaming draft.
  // A draft file means the previous run was interrupted before finalizeRun() could
  // write the assistant message and clean up. Recover the partial text and delete
  // the draft so we don't append it again on the next load.
  const draftPath = getStreamingDraftPath(sessionId);
  try {
    const draftRaw = await fs.readFile(draftPath, 'utf-8');
    const draft = JSON.parse(draftRaw) as { text: string; ts: number };
    if (draft.text && draft.text.trim()) {
      const cleaned = stripActionTags(draft.text);
      const recoveredContent = cleaned
        ? cleaned + '\n\n*(回复在传输中被中断)*'
        : '*(回复在传输中被中断)*';
      messages.push({ role: 'assistant', content: recoveredContent });
    }
    // Always delete the draft after reading — avoid duplicate recovery on next load
    await fs.unlink(draftPath).catch(() => {});
  } catch {
    // No draft file or malformed JSON — normal case, ignore
  }

  return { ...meta, messages };
}

export async function listSessions(agentId: string): Promise<Omit<AgentChatSession, 'messages'>[]> {
  const data = await getIndexData();
  return data.sessions
    .filter(s => s.agentId === agentId && !isEphemeralTestSession(s.id))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function listSessionsByProject(agentId: string, projectKey: string): Promise<Omit<AgentChatSession, 'messages'>[]> {
  const data = await getIndexData();
  return data.sessions
    .filter(s => s.agentId === agentId && s.projectKey === projectKey && !isEphemeralTestSession(s.id))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function listAllSessions(): Promise<Omit<AgentChatSession, 'messages'>[]> {
  const data = await getIndexData();
  return data.sessions
    .filter(s => !isEphemeralTestSession(s.id))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function listGuestSessions(parentSessionId: string): Promise<Omit<AgentChatSession, 'messages'>[]> {
  const data = await getIndexData();
  return data.sessions
    .filter(s => s.parentSessionId === parentSessionId && !isEphemeralTestSession(s.id))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

// ── Session Write Operations ──

export async function markAsRead(sessionId: string): Promise<boolean> {
  let found = false;
  await modifyJsonFile<AgentChatSessionsData>(
    getAgentChatSessionsPath(),
    DEFAULT_SESSIONS_DATA,
    (data) => {
      const session = data.sessions.find(s => s.id === sessionId);
      if (session) {
        session.unreadCount = 0;
        found = true;
      }
      return data;
    },
  );
  invalidateIndexCache();
  return found;
}

export async function setArchived(sessionId: string, archived: boolean): Promise<boolean> {
  let found = false;
  let archivedAgentId: string | undefined;
  await modifyJsonFile<AgentChatSessionsData>(
    getAgentChatSessionsPath(),
    DEFAULT_SESSIONS_DATA,
    (data) => {
      const session = data.sessions.find(s => s.id === sessionId);
      if (session) {
        session.archived = archived || undefined; // don't persist false
        found = true;
        if (archived) archivedAgentId = session.agentId;
        console.log(`[setArchived] ${sessionId} -> archived=${session.archived}`);
      } else {
        console.warn(`[setArchived] ${sessionId} NOT FOUND in ${data.sessions.length} sessions`);
      }
      return data;
    },
  );
  invalidateIndexCache();
  if (archived && found && archivedAgentId) {
    await deleteRuntimePromptCopy(archivedAgentId, sessionId).catch(() => {});
  }
  return found;
}

export async function updateConfigOnDisk(sessionId: string, config: SessionConfig): Promise<boolean> {
  let found = false;
  await modifyJsonFile<AgentChatSessionsData>(
    getAgentChatSessionsPath(),
    DEFAULT_SESSIONS_DATA,
    (data) => {
      const session = data.sessions.find(s => s.id === sessionId);
      if (session) {
        session.config = config;
        session.updatedAt = new Date().toISOString();
        found = true;
      }
      return data;
    },
  );
  invalidateIndexCache();
  return found;
}

export async function loadDeferredInputBuffer(
  sessionId: string,
): Promise<DeferredInputBufferState | undefined> {
  const data = await getAdjunctData();
  return cloneDeferredInputBuffer(data.sessions[sessionId]?.deferredInputBuffer);
}

export const loadPendingUserQueueOnDisk = loadDeferredInputBuffer;

export async function updateDeferredInputBufferOnDisk(
  sessionId: string,
  queue: DeferredInputBufferState,
): Promise<boolean> {
  const data = await getIndexData();
  if (!data.sessions.some((session) => session.id === sessionId)) {
    return false;
  }

  const deferredInputBuffer = cloneDeferredInputBuffer(queue);

  await modifyJsonFile<AgentChatSessionAdjunctsData>(
    getAgentChatSessionAdjunctsPath(),
    DEFAULT_ADJUNCTS_DATA,
    (data) => {
      if (deferredInputBuffer) {
        data.sessions[sessionId] = { deferredInputBuffer };
      } else {
        delete data.sessions[sessionId];
      }
      return data;
    },
  );

  let found = false;
  await modifyJsonFile<AgentChatSessionsData>(
    getAgentChatSessionsPath(),
    DEFAULT_SESSIONS_DATA,
    (data) => {
      const session = data.sessions.find(s => s.id === sessionId);
      if (session) {
        session.updatedAt = new Date().toISOString();
        found = true;
      }
      return data;
    },
  );
  invalidateIndexCache();
  return found;
}

export const updatePendingUserQueueOnDisk = updateDeferredInputBufferOnDisk;

function resolveMessageIndex(
  messageIndex: number,
  diskLen: number,
  frontendMessageCount?: number,
): number {
  let effectiveIndex = messageIndex;
  if (frontendMessageCount !== undefined && frontendMessageCount !== diskLen) {
    const fromEnd = frontendMessageCount - 1 - messageIndex;
    effectiveIndex = Math.max(0, diskLen - 1 - fromEnd);
  }
  return Math.min(effectiveIndex, diskLen - 1);
}

export async function updateUserMessageContentOnDisk(
  sessionId: string,
  messageIndex: number,
  content: string,
  frontendMessageCount?: number,
): Promise<'ok' | 'not_found' | 'out_of_range' | 'not_user' | 'empty'> {
  const data = await getIndexData();
  if (!data.sessions.some((session) => session.id === sessionId)) {
    return 'not_found';
  }

  const messages = await readMessages(sessionId);
  if (messages.length === 0) return 'out_of_range';

  const effectiveIndex = resolveMessageIndex(messageIndex, messages.length, frontendMessageCount);
  const target = messages[effectiveIndex];
  if (!target) return 'out_of_range';
  if (target.role !== 'user') return 'not_user';

  const nextContent = content.trim();
  if (!nextContent && (!target.images || target.images.length === 0)) {
    return 'empty';
  }

  target.content = nextContent;
  if (target.contentBlocks?.some((block) => block.type === 'text')) {
    target.contentBlocks = [{ type: 'text', text: nextContent }];
  }

  await writeAllMessages(sessionId, messages);

  await modifyJsonFile<AgentChatSessionsData>(
    getAgentChatSessionsPath(),
    DEFAULT_SESSIONS_DATA,
    (indexData) => {
      const session = indexData.sessions.find((entry) => entry.id === sessionId);
      if (session) {
        session.updatedAt = new Date().toISOString();
      }
      return indexData;
    },
  );
  invalidateIndexCache();

  return 'ok';
}

export async function deleteSessionFromDisk(sessionId: string): Promise<boolean> {
  let found = false;
  let deletedAgentId: string | undefined;
  await modifyJsonFile<AgentChatSessionsData>(
    getAgentChatSessionsPath(),
    DEFAULT_SESSIONS_DATA,
    (data) => ({
      sessions: data.sessions.filter(s => {
        if (s.id === sessionId) {
          found = true;
          deletedAgentId = s.agentId;
          return false;
        }
        return true;
      }),
    }),
  );
  invalidateIndexCache();

  // Delete the JSONL message file
  await deleteMessageFile(sessionId);
  await deleteSessionAdjuncts(sessionId);

  if (found && deletedAgentId) {
    await deleteRuntimePromptCopy(deletedAgentId, sessionId).catch(() => {});
  }
  return found;
}

export async function branchSession(
  sourceSessionId: string,
  branchAtIndex: number,
  frontendMessageCount?: number,
): Promise<AgentChatSession> {
  const source = await loadSession(sourceSessionId);
  if (!source) throw new Error('Source session not found');

  if (branchAtIndex < 0) {
    throw new Error('Message index out of range');
  }

  const diskLen = source.messages.length;
  const effectiveIndex = resolveMessageIndex(branchAtIndex, diskLen, frontendMessageCount);

  if (diskLen === 0) {
    throw new Error('Source session has no messages');
  }

  const branchedMessages = source.messages.slice(0, effectiveIndex + 1);
  const now = new Date().toISOString();
  const newId = generateSessionId();

  // Write branched messages to new JSONL file
  await writeAllMessages(newId, branchedMessages);

  // Add metadata to index
  const newMeta: SessionMeta = {
    id: newId,
    agentId: source.agentId,
    projectKey: source.projectKey,
    title: `\u{1F33F} ${repairStoredTextIfNeeded(source.title) ?? source.title}`,
    createdAt: now,
    updatedAt: now,
    config: source.config,
    unreadCount: 0,
    messageCount: branchedMessages.length,
  };

  await modifyJsonFile<AgentChatSessionsData>(
    getAgentChatSessionsPath(),
    DEFAULT_SESSIONS_DATA,
    (data) => {
      data.sessions.push(newMeta);
      return data;
    },
  );
  invalidateIndexCache();

  return { ...newMeta, messages: branchedMessages };
}

// ── Internal Helpers (used by AgentChatManager) ──

/**
 * Eagerly write the user's message to disk BEFORE the Claude process starts.
 * Guarantees the user turn survives a dev-server restart.
 *
 * v2: Appends new messages to JSONL, updates index metadata.
 */
export async function eagerlySaveUserTurn(opts: {
  sessionId: string;
  agentId: string;
  projectKey?: string;
  sessionTitle?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; images?: string[]; contentBlocks?: ContentBlock[] }>;
  claudeSessionId?: string;
  config?: SessionConfig;
  parentSessionId?: string;
  importedTurnIndices?: number[];
}): Promise<void> {
  const now = new Date().toISOString();

  // Read existing messages from JSONL to determine what's new
  const existingMessages = await readMessages(opts.sessionId);
  const existingLen = existingMessages.length;
  const incomingLen = opts.messages.length;

  // Only append genuinely new messages
  if (incomingLen > existingLen) {
    const newMessages = opts.messages.slice(existingLen) as ChatMessage[];
    appendMessages(opts.sessionId, newMessages);
  }

  // Update or create index entry
  await modifyJsonFile<AgentChatSessionsData>(
    getAgentChatSessionsPath(),
    DEFAULT_SESSIONS_DATA,
    (data) => {
      const idx = data.sessions.findIndex(s => s.id === opts.sessionId);
      if (idx >= 0) {
        if (incomingLen > existingLen) {
          data.sessions[idx].updatedAt = now;
          data.sessions[idx].messageCount = incomingLen;
        }
        } else {
          const normalizedTitle = repairStoredTextIfNeeded(opts.sessionTitle) ?? '\u65B0\u4F1A\u8BDD';
          data.sessions.push({
            id: opts.sessionId,
            agentId: opts.agentId,
            projectKey: opts.projectKey,
            title: normalizedTitle,
          claudeSessionId: opts.claudeSessionId,
          createdAt: now,
          updatedAt: now,
          config: opts.config,
          parentSessionId: opts.parentSessionId,
          importedTurnIndices: opts.importedTurnIndices,
          unreadCount: 0,
          messageCount: incomingLen,
        });
      }
      return data;
    },
  );
  invalidateIndexCache();
}

/**
 * Persist a completed run's session to disk.
 *
 * v2: Overwrites the JSONL file with the full message array (the run holds the
 * authoritative message list after streaming completes), then updates index metadata.
 */
export async function persistSessionToDisk(
  session: AgentChatSession,
  execution?: import('./types').SessionExecution,
): Promise<void> {
  // Write all messages to JSONL (authoritative after run completes)
  await writeAllMessages(session.id, session.messages);

  // Update index metadata
  await modifyJsonFile<AgentChatSessionsData>(
    getAgentChatSessionsPath(),
    DEFAULT_SESSIONS_DATA,
    (data) => {
      const idx = data.sessions.findIndex(s => s.id === session.id);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { messages: _msgs, ...incomingMeta } = session;
      const meta: SessionMeta = {
        ...incomingMeta,
        title: repairStoredTextIfNeeded(incomingMeta.title) ?? incomingMeta.title,
        messageCount: session.messages.length,
      };

      if (idx >= 0) {
        // Preserve fields from existing index entry
        meta.createdAt = data.sessions[idx].createdAt;
        meta.archived = data.sessions[idx].archived;
        meta.config = meta.config ?? data.sessions[idx].config;
        meta.guardRetryCount = meta.guardRetryCount ?? data.sessions[idx].guardRetryCount;
        meta.unreadCount = (data.sessions[idx].unreadCount || 0) + 1;
        meta.execution = execution ?? data.sessions[idx].execution;
        data.sessions[idx] = meta;
      } else {
        meta.unreadCount = 1;
        if (execution) {
          meta.execution = execution;
        }
        data.sessions.push(meta);
      }
      return data;
    },
  );
  invalidateIndexCache();

  // Delete streaming draft — the run completed normally, draft is superseded
  deleteStreamingDraft(session.id).catch(() => {});
}

export async function incrementGuardRetryCountOnDisk(sessionId: string): Promise<void> {
  await modifyJsonFile<AgentChatSessionsData>(
    getAgentChatSessionsPath(),
    DEFAULT_SESSIONS_DATA,
    (data) => {
      const session = data.sessions.find(s => s.id === sessionId);
      if (session) {
        session.guardRetryCount = (session.guardRetryCount ?? 0) + 1;
      }
      return data;
    },
  );
  invalidateIndexCache();
}

// ── Compress support ──

/**
 * Replace all messages for a session (used by compress/apply).
 * Updates both JSONL file and index messageCount.
 */
export async function replaceSessionMessages(sessionId: string, messages: ChatMessage[]): Promise<boolean> {
  // Write new messages to JSONL
  await writeAllMessages(sessionId, messages);

  // Update index
  let found = false;
  await modifyJsonFile<AgentChatSessionsData>(
    getAgentChatSessionsPath(),
    DEFAULT_SESSIONS_DATA,
    (data) => {
      const session = data.sessions.find(s => s.id === sessionId);
      if (session) {
        session.updatedAt = new Date().toISOString();
        session.messageCount = messages.length;
        found = true;
      }
      return data;
    },
  );
  invalidateIndexCache();
  return found;
}

// ── Bulk operations (for clear/import/export) ──

/**
 * Delete all JSONL message files (used by clear).
 */
export async function deleteAllMessageFiles(): Promise<void> {
  const dir = getAgentChatMessagesDir();
  try {
    const files = await fs.readdir(dir);
    await Promise.all(
      files
        .filter(f => f.endsWith('.jsonl'))
        .map(f => fs.unlink(path.join(dir, f)).catch(() => {})),
    );
  } catch {
    // Directory doesn't exist — nothing to clean
  }
}

/**
 * Export a full session (metadata + messages) for backup/export.
 */
export async function exportSessionFull(sessionId: string): Promise<AgentChatSession | null> {
  return loadSession(sessionId);
}

/**
 * Import sessions with embedded messages (from v1 export format).
 * Extracts messages to JSONL files and stores metadata in index.
 */
export async function importSessionsWithMessages(
  sessions: AgentChatSession[],
): Promise<void> {
  // Write messages to JSONL files
  for (const session of sessions) {
    if (session.messages && session.messages.length > 0) {
      await writeAllMessages(session.id, session.messages);
    }
  }

  // Build metadata entries (without messages)
  const metas: SessionMeta[] = sessions.map((session) =>
    sanitizeSessionMeta({
      ...session,
      messageCount: session.messages?.length ?? 0,
    } as LegacySessionMeta),
  );

  // Merge into index
  await modifyJsonFile<AgentChatSessionsData>(
    getAgentChatSessionsPath(),
    DEFAULT_SESSIONS_DATA,
    (data) => {
      for (const incoming of metas) {
        const idx = data.sessions.findIndex(s => s.id === incoming.id);
        if (idx >= 0) {
          if (incoming.updatedAt > data.sessions[idx].updatedAt) {
            data.sessions[idx] = incoming;
          }
        } else {
          data.sessions.push(incoming);
        }
      }
      return data;
    },
  );
  invalidateIndexCache();
}

// ── Agent Loading ──

let _agentsCache: AgentsData | null = null;
let _agentsCacheTs = 0;
const AGENTS_CACHE_TTL = 30_000;

export async function loadAgent(agentId: string): Promise<Agent> {
  const now = Date.now();
  if (!_agentsCache || now - _agentsCacheTs > AGENTS_CACHE_TTL) {
    _agentsCache = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });
    _agentsCacheTs = now;
  }
  const agentsData = _agentsCache;
  const agent = agentsData.agents.find(a => a.id === agentId && !a.archived);
  if (!agent) {
    const { HttpError } = await import('@/lib/http-error');
    throw new HttpError('Agent not found or archived', 404);
  }
  // Merge default agent fields (runtime migration)
  const builtinAgents = await getDefaultAgents();
  const defaultAgent = builtinAgents.find(a => a.id === agentId);
  if (defaultAgent) {
    for (const key of Object.keys(defaultAgent) as Array<keyof Agent>) {
      if (agent[key] === undefined && defaultAgent[key] !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (agent as any)[key] = defaultAgent[key];
      }
    }
  }
  return agent;
}
