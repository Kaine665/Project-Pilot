/**
 * Agent Chat Session Store — 纯数据操作函数，不依赖任何实例状态。
 *
 * 从 AgentChatManager class 中拆分出来，解决 globalThis 单例导致的 HMR 问题：
 * - 这些函数作为模块级导出，HMR 可以正常更新
 * - class 只保留需要 this.runs（进程 Map）的有状态方法
 *
 * API routes 应直接 import 这些函数，而不是通过 agentChatManager 单例调用。
 */

import {
  getAgentChatSessionsPath,
  getAgentsPath,
  readJsonFile,
  modifyJsonFile,
} from '@/lib/file-store';
import { deleteRuntimePromptCopy } from '@/lib/agent-prompt-store';
import type { Agent, AgentsData, ContentBlock } from '@/types';
import type { AgentChatSession, AgentChatSessionsData, SessionConfig } from '@/types/agent-chat';
import { DEFAULT_AGENTS } from '@/lib/default-agents';

// ── Constants ──

const DEFAULT_SESSIONS_DATA: AgentChatSessionsData = { sessions: [] };

// ── Sessions data cache (reduce repeated full-file reads) ──
let _sessionsCache: AgentChatSessionsData | null = null;
let _sessionsCacheTs = 0;
const SESSIONS_CACHE_TTL = 3_000; // 3s

async function getSessionsData(): Promise<AgentChatSessionsData> {
  const now = Date.now();
  if (_sessionsCache && now - _sessionsCacheTs < SESSIONS_CACHE_TTL) {
    return _sessionsCache;
  }
  _sessionsCache = await readJsonFile<AgentChatSessionsData>(
    getAgentChatSessionsPath(),
    DEFAULT_SESSIONS_DATA,
  );
  _sessionsCacheTs = now;
  return _sessionsCache;
}

/** 写操作后使缓存失效 */
function invalidateSessionsCache(): void {
  _sessionsCache = null;
  _sessionsCacheTs = 0;
}

// ── ID Generation ──

export function generateSessionId(): string {
  return `agent-chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── Session Read Operations ──

/** 测试连接会话（__test-*）不列入会话列表，测完即销毁 */
const isEphemeralTestSession = (id: string) => id.startsWith('__test-');

export async function loadSession(sessionId: string): Promise<AgentChatSession | null> {
  const data = await getSessionsData();
  return data.sessions.find(s => s.id === sessionId) ?? null;
}

export async function listSessions(agentId: string): Promise<Omit<AgentChatSession, 'messages'>[]> {
  const data = await getSessionsData();
  return data.sessions
    .filter(s => s.agentId === agentId && !isEphemeralTestSession(s.id))
    .map(({ messages: _msgs, ...rest }) => rest)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function listSessionsByProject(agentId: string, projectKey: string): Promise<Omit<AgentChatSession, 'messages'>[]> {
  const data = await getSessionsData();
  return data.sessions
    .filter(s => s.agentId === agentId && s.projectKey === projectKey && !isEphemeralTestSession(s.id))
    .map(({ messages: _msgs, ...rest }) => rest)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function listAllSessions(): Promise<Omit<AgentChatSession, 'messages'>[]> {
  const data = await getSessionsData();
  return data.sessions
    .filter(s => !isEphemeralTestSession(s.id))
    .map(({ messages: _msgs, ...rest }) => rest)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function listGuestSessions(parentSessionId: string): Promise<Omit<AgentChatSession, 'messages'>[]> {
  const data = await getSessionsData();
  return data.sessions
    .filter(s => s.parentSessionId === parentSessionId && !isEphemeralTestSession(s.id))
    .map(({ messages: _msgs, ...rest }) => rest)
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
  invalidateSessionsCache();
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
        console.log(`[setArchived] ${sessionId} → archived=${session.archived}`);
      } else {
        console.warn(`[setArchived] ${sessionId} NOT FOUND in ${data.sessions.length} sessions`);
      }
      return data;
    },
  );
  invalidateSessionsCache();
  // 归档时清理运行时 prompt 副本（软删除也应触发，避免文件堆积）
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
  invalidateSessionsCache();
  return found;
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
  invalidateSessionsCache();
  // 清理运行时 prompt 副本
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

  // When the frontend's message array is out of sync with disk (e.g. local
  // deletions, streaming messages not yet persisted), the index may refer to
  // a different position on disk. Clamp to disk bounds to avoid silent data
  // loss or errors, and prefer using the relative position from the end when
  // the frontend has extra messages that disk doesn't.
  let effectiveIndex = branchAtIndex;
  const diskLen = source.messages.length;
  if (frontendMessageCount !== undefined && frontendMessageCount !== diskLen) {
    // Frontend has more messages (e.g. streaming assistant not yet persisted):
    // the user's intended offset from the end is more reliable than absolute index.
    const fromEnd = frontendMessageCount - 1 - branchAtIndex;
    effectiveIndex = Math.max(0, diskLen - 1 - fromEnd);
  }
  effectiveIndex = Math.min(effectiveIndex, diskLen - 1);

  if (diskLen === 0) {
    throw new Error('Source session has no messages');
  }

  const branchedMessages = source.messages.slice(0, effectiveIndex + 1);
  const now = new Date().toISOString();
  const newId = generateSessionId();
  const newSession: AgentChatSession = {
    id: newId,
    agentId: source.agentId,
    projectKey: source.projectKey,
    title: `🌿 ${source.title}`,
    messages: branchedMessages,
    createdAt: now,
    updatedAt: now,
    config: source.config,
    unreadCount: 0,
  };

  await modifyJsonFile<AgentChatSessionsData>(
    getAgentChatSessionsPath(),
    DEFAULT_SESSIONS_DATA,
    (data) => {
      data.sessions.push(newSession);
      return data;
    },
  );
  invalidateSessionsCache();

  return newSession;
}

// ── Internal Helpers (used by AgentChatManager) ──

/**
 * Eagerly write the user's message to disk BEFORE the Claude process starts.
 * Guarantees the user turn survives a dev-server restart.
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
  await modifyJsonFile<AgentChatSessionsData>(
    getAgentChatSessionsPath(),
    DEFAULT_SESSIONS_DATA,
    (data) => {
      const idx = data.sessions.findIndex(s => s.id === opts.sessionId);
      if (idx >= 0) {
        if (data.sessions[idx].messages.length < opts.messages.length) {
          data.sessions[idx].messages = opts.messages;
          data.sessions[idx].updatedAt = now;
        }
      } else {
        data.sessions.push({
          id: opts.sessionId,
          agentId: opts.agentId,
          projectKey: opts.projectKey,
          title: opts.sessionTitle ?? '新会话',
          messages: opts.messages,
          claudeSessionId: opts.claudeSessionId,
          createdAt: now,
          updatedAt: now,
          config: opts.config,
          parentSessionId: opts.parentSessionId,
          importedTurnIndices: opts.importedTurnIndices,
          unreadCount: 0,
        });
      }
      return data;
    },
  );
  invalidateSessionsCache();
}

/**
 * Persist a completed run's session to disk.
 */
export async function persistSessionToDisk(session: AgentChatSession): Promise<void> {
  await modifyJsonFile<AgentChatSessionsData>(
    getAgentChatSessionsPath(),
    DEFAULT_SESSIONS_DATA,
    (data) => {
      const idx = data.sessions.findIndex(s => s.id === session.id);
      if (idx >= 0) {
        session.createdAt = data.sessions[idx].createdAt;
        session.archived = data.sessions[idx].archived;
        session.config = session.config ?? data.sessions[idx].config;
        session.guardRetryCount = session.guardRetryCount ?? data.sessions[idx].guardRetryCount;
        session.unreadCount = (data.sessions[idx].unreadCount || 0) + 1;
        data.sessions[idx] = session;
      } else {
        session.unreadCount = 1;
        data.sessions.push(session);
      }
      return data;
    },
  );
  invalidateSessionsCache();
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
  invalidateSessionsCache();
}

// ── Agent Loading ──

let _agentsCache: AgentsData | null = null;
let _agentsCacheTs = 0;
const AGENTS_CACHE_TTL = 30_000; // 30s (与 settings 和 agents route 缓存 TTL 一致)

export async function loadAgent(agentId: string): Promise<Agent> {
  const now = Date.now();
  if (!_agentsCache || now - _agentsCacheTs > AGENTS_CACHE_TTL) {
    _agentsCache = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });
    _agentsCacheTs = now;
  }
  const agentsData = _agentsCache;
  const agent = agentsData.agents.find(a => a.id === agentId && !a.archived);
  if (!agent) {
    throw new Error('Agent not found or archived');
  }
  // Merge default agent fields (runtime migration)
  const defaultAgent = DEFAULT_AGENTS.find(a => a.id === agentId);
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
