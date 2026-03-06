/**
 * AgentChatManager — Lightweight Claude subprocess manager for Agent conversations.
 *
 * Extends BaseChatManager with:
 * - Multi-session support (sessionId-indexed)
 * - Image attachment handling (temp files + --image args)
 * - AgentAction processing (tag parse → execute → strip via actionRegistry)
 * - Guest Agent (spectator mode with imported turns)
 * - Session CRUD (list, load, delete, persisted to agent-chat-sessions.json)
 */

import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { BaseChatManager } from './base-chat-manager';
import type { BaseRun, SpawnConfig } from './types';
import type { StreamParser } from '@/lib/claude-stream-parser';
import {
  getAgentChatSessionsPath,
  getAgentsPath,
  getPromptFilePath,
  readJsonFile,
  modifyJsonFile,
} from '@/lib/file-store';
import { resolveSystemPrompt, createRuntimePromptCopy, deleteRuntimePromptCopy } from '@/lib/agent-prompt-store';
import {
  buildClaudeEnv,
  buildClaudeModelArgs,
  buildClaudeMaxTurnsArgs,
  buildAgentPermissionArgs,
  buildAgentToolArgs,
} from '@/lib/settings-manager';
import type { ChatSSEEvent, ContentBlock, Agent, AgentsData } from '@/types';
import type { AgentChatSession, AgentChatSessionsData, SessionConfig } from '@/types/agent-chat';
import { DEFAULT_AGENTS } from '@/lib/default-agents';
import type { ResourceRef, InlineTextRef, FlowContextRef, ReferenceTurnsRef } from '@/types/resource';
import { resourceRegistry } from '@/lib/resource-registry';
import '@/lib/resource-loaders'; // side-effect: registers non-action loaders
import '@/lib/agent-actions';    // side-effect: registers actions + their loaders
import { actionRegistry } from '@/lib/agent-actions';
import { migrateAgentToResources } from '@/lib/resource-migration';
import type { SystemPromptLoaderContext } from '@/lib/resource-loaders/system-prompt-loader';
import { checkSessionHealth, buildGuardMessage } from './session-health-guard';

// ── Types ──

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface ImageAttachment {
  mediaType: ImageMediaType;
  data: string; // base64
}

export interface FlowContext {
  projectKey: string;
  projectName: string;
  flowDataPath: string;
}

export interface AgentChatRun extends BaseRun {
  sessionId: string;
  agentId: string;
  projectKey?: string;
  sessionTitle?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; images?: string[]; contentBlocks?: ContentBlock[] }>;
  // Session-level config (supplementary context & prompt)
  config?: SessionConfig;
  // Guest Agent
  parentSessionId?: string;
  importedTurnIndices?: number[];
  // Temp image paths (for cleanup)
  _tempImagePaths?: string[];
  // Health guard retry count (prevents recursive guard triggers)
  _guardRetryCount?: number;
}

// ── Domain data (passed through SpawnConfig to createRun) ──

interface AgentChatDomainData {
  sessionId: string;
  agentId: string;
  projectKey?: string;
  sessionTitle?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; images?: string[]; contentBlocks?: ContentBlock[] }>;
  tempPaths: string[];
  config?: SessionConfig;
  parentSessionId?: string;
  importedTurnIndices?: number[];
}

// ── Helpers ──

const DEFAULT_SESSIONS_DATA: AgentChatSessionsData = { sessions: [] };

export function generateSessionId(): string {
  return `agent-chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── AgentChatManager ──

class AgentChatManager extends BaseChatManager<AgentChatRun> {
  protected readonly completedTtlMs = 10 * 60 * 1000; // 10 minutes
  protected readonly logPrefix = '[AgentChat]';

  // ═══════════════════════════════════════════════════════════════════════
  // Public: start a conversation
  // ═══════════════════════════════════════════════════════════════════════

  async start(
    sessionId: string,
    agentId: string,
    message: string,
    flowContext?: FlowContext,
    images?: ImageAttachment[],
    initialTitle?: string,
    initialConfig?: SessionConfig,
    parentSessionId?: string,
  ): Promise<string> {
    const agent = await this.loadAgent(agentId);

    let existing = this.runs.get(sessionId);

    // Hydrate from disk if not in memory
    if (!existing) {
      const diskSession = await this.loadSession(sessionId);
      if (diskSession) {
        existing = this.hydrateFromDisk(diskSession);
        this.runs.set(sessionId, existing);
      }
    }

    if (existing?.status === 'running') {
      throw new Error('This session is already running');
    }

    const isResume = !!existing?.claudeSessionId;

    // Build or reuse message history (copy to prevent shared mutation)
    const messages = existing?.messages ? [...existing.messages] : [];
    const dataUrls = images?.map(img => `data:${img.mediaType};base64,${img.data}`);
    messages.push({ role: 'user', content: message, images: dataUrls?.length ? dataUrls : undefined });

    // Resolve session config: initialConfig (from API) > existing run/disk config
    const sessionConfig = initialConfig ?? existing?.config;

    // Build prompt
    let stdinContent: string;
    if (isResume) {
      stdinContent = message;
    } else if (flowContext) {
      stdinContent = await buildAgentChatPromptWithFlowContext(agent, message, flowContext, sessionConfig, sessionId);
    } else {
      stdinContent = await buildAgentChatPrompt(agent, message, sessionConfig, sessionId);
    }

    // Write images to temp files
    const tempPaths: string[] = [];
    const imageArgs: string[] = [];
    const extMap: Record<string, string> = {
      'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
    };
    if (images && images.length > 0) {
      for (const img of images) {
        const ext = extMap[img.mediaType] ?? 'png';
        const tmpPath = join(tmpdir(), `agent-img-${randomBytes(8).toString('hex')}.${ext}`);
        await writeFile(tmpPath, Buffer.from(img.data, 'base64'));
        tempPaths.push(tmpPath);
        imageArgs.push('--image', tmpPath);
      }
    }

    // Build CLI args
    const chatEnv = await buildClaudeEnv();
    const chatModelArgs = await buildClaudeModelArgs();
    const chatMaxTurnsArgs = await buildClaudeMaxTurnsArgs();
    const chatPermArgs = await buildAgentPermissionArgs('executing', agent.capabilities);
    const chatToolArgs = buildAgentToolArgs(agent.capabilities);
    const resumeArgs = isResume ? ['--resume', existing!.claudeSessionId!] : [];

    const config: SpawnConfig<AgentChatDomainData> = {
      runKey: sessionId,
      workingDir: process.cwd(),
      stdinContent,
      isResume,
      claudeSessionId: existing?.claudeSessionId,
      extraCliArgs: [
        ...chatPermArgs,
        ...chatToolArgs,
        ...chatModelArgs,
        ...chatMaxTurnsArgs,
        ...resumeArgs,
        ...imageArgs,
      ],
      env: chatEnv,
      domainData: {
        sessionId,
        agentId,
        projectKey: flowContext?.projectKey ?? existing?.projectKey,
        sessionTitle: existing?.sessionTitle ?? initialTitle,
        messages,
        tempPaths,
        config: sessionConfig,
        parentSessionId: parentSessionId ?? existing?.parentSessionId,
      },
    };

    // Eagerly persist the user message to disk BEFORE spawning the process.
    // This guarantees the data is written during the HTTP request (before the
    // 200 response is sent), so a dev-server restart (next.config.ts change)
    // cannot kill Node before the write completes.
    await this.eagerlySaveUserTurn({
      sessionId,
      agentId,
      projectKey: flowContext?.projectKey ?? existing?.projectKey,
      sessionTitle: existing?.sessionTitle ?? initialTitle,
      messages,
      claudeSessionId: existing?.claudeSessionId,
      config: sessionConfig,
      parentSessionId: parentSessionId ?? existing?.parentSessionId,
      importedTurnIndices: undefined,
    });

    const run = await this.spawnAndManage(config);
    return run.runId;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Public: start a guest (spectator) session
  // ═══════════════════════════════════════════════════════════════════════

  async startGuest(
    guestSessionId: string,
    agentId: string,
    message: string,
    parentSessionId: string,
    importedTurnIndices: number[] | 'all',
  ): Promise<string> {
    // Load host session messages
    const hostSession = await this.loadSession(parentSessionId);
    if (!hostSession) {
      throw new Error('Host session not found');
    }

    // Resolve imported turns
    let selectedTurns: Array<{ role: 'user' | 'assistant'; content: string }>;
    let turnIndices: number[];
    if (importedTurnIndices === 'all') {
      selectedTurns = hostSession.messages.map(m => ({ role: m.role, content: m.content }));
      turnIndices = hostSession.messages.map((_, i) => i);
    } else {
      turnIndices = importedTurnIndices.filter(i => i >= 0 && i < hostSession.messages.length);
      selectedTurns = turnIndices.map(i => ({
        role: hostSession.messages[i].role,
        content: hostSession.messages[i].content,
      }));
    }

    const agent = await this.loadAgent(agentId);

    const existing = this.runs.get(guestSessionId);
    if (existing?.status === 'running') {
      throw new Error('This guest session is already running');
    }

    const isResume = !!existing?.claudeSessionId;
    const messages = existing?.messages ? [...existing.messages] : [];
    messages.push({ role: 'user', content: message });

    // Build prompt
    let stdinContent: string;
    if (isResume) {
      stdinContent = message;
    } else {
      stdinContent = await buildGuestAgentPrompt(agent, message, selectedTurns);
    }

    // Build CLI args
    const chatEnv = await buildClaudeEnv();
    const chatModelArgs = await buildClaudeModelArgs();
    const chatMaxTurnsArgs = await buildClaudeMaxTurnsArgs();
    const chatPermArgs = await buildAgentPermissionArgs('executing', agent.capabilities);
    const chatToolArgs = buildAgentToolArgs(agent.capabilities);
    const resumeArgs = isResume ? ['--resume', existing!.claudeSessionId!] : [];

    const config: SpawnConfig<AgentChatDomainData> = {
      runKey: guestSessionId,
      workingDir: process.cwd(),
      stdinContent,
      isResume,
      claudeSessionId: existing?.claudeSessionId,
      extraCliArgs: [
        ...chatPermArgs,
        ...chatToolArgs,
        ...chatModelArgs,
        ...chatMaxTurnsArgs,
        ...resumeArgs,
      ],
      env: chatEnv,
      domainData: {
        sessionId: guestSessionId,
        agentId,
        sessionTitle: existing?.sessionTitle,
        messages,
        tempPaths: [],
        parentSessionId,
        importedTurnIndices: turnIndices,
      },
    };

    const run = await this.spawnAndManage(config);
    return run.runId;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Public: session CRUD (disk-backed)
  // ═══════════════════════════════════════════════════════════════════════

  getMessages(sessionId: string): Array<{ role: 'user' | 'assistant'; content: string }> {
    const run = this.runs.get(sessionId);
    if (!run) return [];
    return run.messages;
  }

  getRunningForAgent(agentId: string): string | null {
    for (const [sessionId, run] of this.runs) {
      if (run.agentId === agentId && run.status === 'running') {
        return sessionId;
      }
    }
    return null;
  }

  getRunningForProject(projectKey: string): string | null {
    for (const [sessionId, run] of this.runs) {
      if (run.projectKey === projectKey && run.status === 'running') {
        return sessionId;
      }
    }
    return null;
  }

  clear(sessionId: string): void {
    const run = this.runs.get(sessionId);
    if (run?.status === 'running') return;
    this.runs.delete(sessionId);
  }

  async loadSession(sessionId: string): Promise<AgentChatSession | null> {
    const data = await readJsonFile<AgentChatSessionsData>(
      getAgentChatSessionsPath(),
      DEFAULT_SESSIONS_DATA,
    );
    return data.sessions.find(s => s.id === sessionId) ?? null;
  }

  async listSessions(agentId: string): Promise<Omit<AgentChatSession, 'messages'>[]> {
    const data = await readJsonFile<AgentChatSessionsData>(
      getAgentChatSessionsPath(),
      DEFAULT_SESSIONS_DATA,
    );
    return data.sessions
      .filter(s => s.agentId === agentId)
      .map(({ messages: _msgs, ...rest }) => rest)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async listSessionsByProject(agentId: string, projectKey: string): Promise<Omit<AgentChatSession, 'messages'>[]> {
    const data = await readJsonFile<AgentChatSessionsData>(
      getAgentChatSessionsPath(),
      DEFAULT_SESSIONS_DATA,
    );
    return data.sessions
      .filter(s => s.agentId === agentId && s.projectKey === projectKey)
      .map(({ messages: _msgs, ...rest }) => rest)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async listAllSessions(): Promise<Omit<AgentChatSession, 'messages'>[]> {
    const data = await readJsonFile<AgentChatSessionsData>(
      getAgentChatSessionsPath(),
      DEFAULT_SESSIONS_DATA,
    );
    return data.sessions
      .map(({ messages: _msgs, ...rest }) => rest)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    this.clear(sessionId);
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
    // 清理运行时 prompt 副本
    if (found && deletedAgentId) {
      await deleteRuntimePromptCopy(deletedAgentId, sessionId).catch(() => {});
    }
    return found;
  }

  async markAsRead(sessionId: string): Promise<boolean> {
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
    return found;
  }

  async setArchived(sessionId: string, archived: boolean): Promise<boolean> {
    let found = false;
    await modifyJsonFile<AgentChatSessionsData>(
      getAgentChatSessionsPath(),
      DEFAULT_SESSIONS_DATA,
      (data) => {
        const session = data.sessions.find(s => s.id === sessionId);
        if (session) {
          session.archived = archived || undefined; // don't persist false
          found = true;
          console.log(`[setArchived] ${sessionId} → archived=${session.archived}`);
        } else {
          console.warn(`[setArchived] ${sessionId} NOT FOUND in ${data.sessions.length} sessions`);
        }
        return data;
      },
    );
    return found;
  }

  async updateConfig(sessionId: string, config: SessionConfig): Promise<boolean> {
    // Update in-memory run if present
    const run = this.runs.get(sessionId);
    if (run) {
      run.config = config;
    }
    // Persist to disk
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
    return found;
  }

  async listGuestSessions(parentSessionId: string): Promise<Omit<AgentChatSession, 'messages'>[]> {
    const data = await readJsonFile<AgentChatSessionsData>(
      getAgentChatSessionsPath(),
      DEFAULT_SESSIONS_DATA,
    );
    return data.sessions
      .filter(s => s.parentSessionId === parentSessionId)
      .map(({ messages: _msgs, ...rest }) => rest)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Protected: BaseChatManager abstract implementations
  // ═══════════════════════════════════════════════════════════════════════

  protected createRun(config: SpawnConfig<AgentChatDomainData>, shell: BaseRun): AgentChatRun {
    const d = config.domainData;
    return {
      ...shell,
      sessionId: d.sessionId,
      agentId: d.agentId,
      projectKey: d.projectKey,
      sessionTitle: d.sessionTitle,
      messages: d.messages,
      config: d.config,
      parentSessionId: d.parentSessionId,
      importedTurnIndices: d.importedTurnIndices,
      _tempImagePaths: d.tempPaths,
    };
  }

  protected async persistAfterClose(run: AgentChatRun, _aborted: boolean): Promise<void> {
    await this.persistSession(run);

    // ── Session Health Guard ──
    // Trigger a lightweight check when a session ends abnormally.
    // Fire-and-forget: guard errors must not affect the main flow.
    if (
      (run.status === 'failed' || run.status === 'stopped')
      && !(run._guardRetryCount && run._guardRetryCount >= 1)
    ) {
      const tailText = run.assistantText.slice(-100);
      checkSessionHealth({
        sessionId: run.sessionId,
        agentId: run.agentId,
        status: run.status,
        tailText,
        guardRetryCount: run._guardRetryCount ?? 0,
      }).then(async (result) => {
        if (!result?.abnormal) return;

        // Bump guard retry count on disk before resuming
        await this.incrementGuardRetryCount(run.sessionId);

        // Resume the session with the guard's error description
        const guardMsg = buildGuardMessage(run.status, result.reason);
        try {
          await this.start(run.sessionId, run.agentId, guardMsg);
          console.log(`${this.logPrefix} Health guard resumed session ${run.sessionId}`);
        } catch (err) {
          console.error(`${this.logPrefix} Health guard failed to resume session:`, err);
        }
      }).catch(err => console.error(`${this.logPrefix} Health guard error:`, err));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Protected: hook overrides
  // ═══════════════════════════════════════════════════════════════════════

  protected async onProcessClose(
    run: AgentChatRun,
    _aborted: boolean,
    _streamParser: StreamParser,
  ): Promise<void> {
    // Clean up temp image files
    if (run._tempImagePaths) {
      for (const tmpPath of run._tempImagePaths) {
        unlink(tmpPath).catch(() => {});
      }
    }

    // Process all agent actions: parse tags, execute side-effects, strip tags
    if (run.assistantText) {
      const actionCtx = {
        sessionId: run.sessionId,
        agentId: run.agentId,
        emit: (event: ChatSSEEvent) => this.trackAndEmit(run, event),
        setSessionTitle: (title: string) => { if (!run.sessionTitle) run.sessionTitle = title; },
      };

      const cleaned = await actionRegistry.processResponse(run.assistantText, actionCtx);

      // Fallback title if no AI-generated title was set
      if (!run.sessionTitle) {
        const firstUserMsg = run.messages.find(m => m.role === 'user')?.content;
        const defaultTitle = run.parentSessionId ? '旁听会话' : '新会话';
        run.sessionTitle = firstUserMsg ? firstUserMsg.slice(0, 30) + '...' : defaultTitle;
      }

      // Emit structured title event so frontend can update immediately
      this.trackAndEmit(run, { type: 'session_title_set', title: run.sessionTitle });

      // Also clean contentBlocks text entries
      const cleanedBlocks = run.contentBlocks.map(block => {
        if (block.type === 'text') {
          return { ...block, text: actionRegistry.stripAll(block.text) };
        }
        return block;
      }).filter(block => !(block.type === 'text' && !block.text.trim()));

      run.messages.push({
        role: 'assistant',
        content: cleaned,
        contentBlocks: cleanedBlocks.length > 0 ? cleanedBlocks : undefined,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Private helpers
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Eagerly write the user's message to disk BEFORE the Claude process starts.
   * Called synchronously (awaited) inside start() so the write completes during
   * the HTTP request, before the 200 response is sent. This guarantees the
   * user turn survives a dev-server restart (next.config.ts change triggers a
   * full page reload which wipes React state).
   *
   * Safety: the modifyJsonFile callback only writes if the stored session has
   * fewer messages than we have now, guarding against any race with
   * persistAfterClose on multi-turn resumes.
   */
  private async eagerlySaveUserTurn(opts: {
    sessionId: string;
    agentId: string;
    projectKey?: string;
    sessionTitle?: string;
    messages: AgentChatRun['messages'];
    claudeSessionId?: string;
    config?: import('@/types/agent-chat').SessionConfig;
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
          // Only update if we have more messages than what's already on disk
          if (data.sessions[idx].messages.length < opts.messages.length) {
            data.sessions[idx].messages = opts.messages;
            data.sessions[idx].updatedAt = now;
          }
        } else {
          // First turn of a brand-new session — create it
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
            unreadCount: 0, // persistAfterClose will increment this when done
          });
        }
        return data;
      },
    );
  }

  private async loadAgent(agentId: string): Promise<Agent> {
    const agentsData = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });
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

  private hydrateFromDisk(diskSession: AgentChatSession): AgentChatRun {
    return {
      runId: '',
      sessionId: diskSession.id,
      agentId: diskSession.agentId,
      projectKey: diskSession.projectKey,
      process: null,
      status: 'completed',
      events: [],
      listeners: new Set(),
      startedAt: new Date(diskSession.createdAt).getTime(),
      assistantText: '',
      contentBlocks: [],
      toolCalls: [],
      claudeSessionId: diskSession.claudeSessionId,
      sessionTitle: diskSession.title,
      messages: [...diskSession.messages],
      config: diskSession.config,
      _guardRetryCount: diskSession.guardRetryCount,
    };
  }

  private async incrementGuardRetryCount(sessionId: string): Promise<void> {
    // Update in-memory run
    const run = this.runs.get(sessionId);
    if (run) {
      run._guardRetryCount = (run._guardRetryCount ?? 0) + 1;
    }
    // Persist to disk
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
  }

  private async persistSession(run: AgentChatRun): Promise<void> {
    const now = new Date().toISOString();
    const session: AgentChatSession = {
      id: run.sessionId,
      agentId: run.agentId,
      projectKey: run.projectKey,
      title: run.sessionTitle ?? '新会话',
      messages: run.messages,
      claudeSessionId: run.claudeSessionId,
      createdAt: new Date(run.startedAt).toISOString(),
      updatedAt: now,
      config: run.config,
      guardRetryCount: run._guardRetryCount,
      parentSessionId: run.parentSessionId,
      importedTurnIndices: run.importedTurnIndices,
    };

    await modifyJsonFile<AgentChatSessionsData>(
      getAgentChatSessionsPath(),
      DEFAULT_SESSIONS_DATA,
      (data) => {
        const idx = data.sessions.findIndex(s => s.id === run.sessionId);
        if (idx >= 0) {
          session.createdAt = data.sessions[idx].createdAt;
          session.archived = data.sessions[idx].archived; // preserve archive state
          session.config = session.config ?? data.sessions[idx].config; // preserve config
          session.guardRetryCount = session.guardRetryCount ?? data.sessions[idx].guardRetryCount; // preserve guard count
          // Increment unread count (agent replied)
          session.unreadCount = (data.sessions[idx].unreadCount || 0) + 1;
          data.sessions[idx] = session;
        } else {
          session.unreadCount = 1;
          data.sessions.push(session);
        }
        return data;
      },
    );
  }
}

// ── Unified Resource-based Prompt Builder ──

/**
 * Resolve an agent's effective resources and format them into prompt text.
 *
 * If the agent has `defaultResources`, use those directly.
 * Otherwise, derive them from legacy fields (contextIds, todoRead, etc.)
 * via migrateAgentToResources().
 *
 * Extra refs (e.g. flow-context, reference-turns) can be appended.
 * Session-level config (contextIds, supplementaryPrompt) is merged as extra refs.
 */
async function buildResourcePrompt(
  agent: Agent,
  extraRefs?: ResourceRef[],
  sessionConfig?: SessionConfig,
  sessionId?: string,
): Promise<string> {
  const baseRefs = agent.defaultResources ?? migrateAgentToResources(agent);
  const merged: ResourceRef[] = [...baseRefs];
  if (extraRefs) merged.push(...extraRefs);

  // Merge session-level config into resource refs
  if (sessionConfig) {
    // Session context IDs → context refs (priority 35, after agent's 30)
    if (sessionConfig.contextIds?.length) {
      for (const cid of sessionConfig.contextIds) {
        merged.push({ type: 'context', id: cid, priority: 35 });
      }
    }
    // Session supplementary prompt → inline-text ref (priority 5, right after system prompt)
    if (sessionConfig.supplementaryPrompt?.trim()) {
      const promptRef: InlineTextRef = {
        type: 'inline-text',
        id: '_session-supplementary',
        priority: 5,
        label: '会话补充提示词',
        inlineContent: sessionConfig.supplementaryPrompt.trim(),
      };
      merged.push(promptRef);
    }
  }

  const allRefs = merged;

  // Resolve system prompt: prefer .md file, fallback to inline, then auto-generated
  const resolved = await resolveSystemPrompt(agent.id, agent.systemPrompt);
  const systemPromptText = resolved
    || `你是一个名为「${agent.name}」的 AI 助手。${agent.description || ''}`;

  // 创建运行时工作副本（仅 exposePromptPath + 有 sessionId 时）
  let runtimePromptPath: string | undefined;
  if (agent.capabilities?.exposePromptPath && sessionId) {
    runtimePromptPath = await createRuntimePromptCopy(agent.id, sessionId);
  }

  const ctx: SystemPromptLoaderContext = {
    agentId: agent.id,
    systemPromptText,
    // exposePromptPath: pass prompt file path if the agent opts in
    promptFilePath: agent.capabilities?.exposePromptPath ? getPromptFilePath(agent.id) : undefined,
    runtimePromptPath,
  };

  const resolvedResources = await resourceRegistry.resolveAll(allRefs, ctx);
  return resourceRegistry.formatAsPrompt(resolvedResources);
}

// ── Prompt Builders (powered by Resource Registry) ──

async function buildAgentChatPrompt(agent: Agent, message: string, sessionConfig?: SessionConfig, sessionId?: string): Promise<string> {
  const resourcePrompt = await buildResourcePrompt(agent, undefined, sessionConfig, sessionId);

  return `${resourcePrompt}

---

用户消息：${message}`;
}

async function buildAgentChatPromptWithFlowContext(
  agent: Agent,
  message: string,
  flowContext: FlowContext,
  sessionConfig?: SessionConfig,
  sessionId?: string,
): Promise<string> {
  const { projectKey, projectName, flowDataPath } = flowContext;

  const flowRef: FlowContextRef = {
    type: 'flow-context',
    id: '_snapshot',
    priority: 70,
    label: '项目上下文',
    projectKey,
    projectName,
    flowDataPath,
  };

  const resourcePrompt = await buildResourcePrompt(agent, [flowRef], sessionConfig, sessionId);

  return `${resourcePrompt}

---

用户消息：${message}`;
}

async function buildGuestAgentPrompt(
  agent: Agent,
  message: string,
  importedTurns: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<string> {
  const extraRefs: ResourceRef[] = [];

  if (importedTurns.length > 0) {
    const turnsRef: ReferenceTurnsRef = {
      type: 'reference-turns',
      id: '_imported',
      priority: 60,
      label: '参考对话',
      turns: importedTurns,
    };
    extraRefs.push(turnsRef);
  }

  const resourcePrompt = await buildResourcePrompt(agent, extraRefs);

  return `${resourcePrompt}

---

用户消息：${message}`;
}

// ── Singleton ──

const globalForAC = globalThis as unknown as {
  __agentChatManager?: AgentChatManager;
};

export const agentChatManager =
  globalForAC.__agentChatManager ?? new AgentChatManager();

if (process.env.NODE_ENV !== 'production') {
  globalForAC.__agentChatManager = agentChatManager;
}
