/**
 * AgentChatManager — 轻量级 Claude 子进程管理器，用于 Agent 直接对话。
 *
 * 基于 PlannerManager 模式：
 * - 按 sessionId 索引（支持多会话）
 * - 无阶段管理、无产物提取、无 git 管理
 * - 会话持久化到 data/agent-chat-sessions.json
 * - 支持 --resume 多轮对话
 * - 使用 Agent 的 systemPrompt 和 capabilities
 */

import { spawn, type ChildProcess } from 'child_process';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { StreamParser, LineBuffer } from '@/lib/claude-stream-parser';
import {
  getAgentChatSessionsPath,
  getAgentsPath,
  getContextIndexPath,
  getContextFilePath,
  getContextDir,
  readJsonFile,
  modifyJsonFile,
} from '@/lib/file-store';
import type { ContextIndexData, ContextEntry } from '@/types';
import {
  buildClaudeEnv,
  buildClaudeModelArgs,
  buildClaudeMaxTurnsArgs,
  buildAgentPermissionArgs,
  buildAgentToolArgs,
} from '@/lib/settings-manager';
import type { ChatSSEEvent, ChatToolCall, ContentBlock, Agent, AgentsData } from '@/types';
import type { AgentChatSession, AgentChatSessionsData } from '@/types/agent-chat';
import { DEFAULT_AGENTS } from '@/lib/default-agents';

// ── Types ──

export type RunStatus = 'running' | 'completed' | 'failed' | 'stopped';

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

export interface AgentChatRun {
  runId: string;
  sessionId: string;
  agentId: string;
  projectKey?: string;
  process: ChildProcess | null;
  status: RunStatus;
  events: ChatSSEEvent[];
  listeners: Set<(event: ChatSSEEvent, index: number) => void>;
  startedAt: number;
  completedAt?: number;

  // Accumulation
  assistantText: string;
  contentBlocks: ContentBlock[];
  toolCalls: ChatToolCall[];

  // Resume support
  claudeSessionId?: string;

  // Session title (AI-generated or fallback)
  sessionTitle?: string;

  // Message history
  messages: Array<{ role: 'user' | 'assistant'; content: string; images?: string[] }>;

  // Guest Agent（旁听 Agent）
  parentSessionId?: string;
  importedTurnIndices?: number[];
}

export interface RunStatusInfo {
  status: RunStatus | 'none';
  runId?: string;
  eventCount: number;
  startedAt?: string;
}

// ── Helpers ──

const DEFAULT_SESSIONS_DATA: AgentChatSessionsData = { sessions: [] };

function extractSessionTitle(text: string): string | null {
  const match = text.match(/<session-title>([\s\S]*?)<\/session-title>/);
  return match ? match[1].trim() : null;
}

function stripSessionTitle(text: string): string {
  return text.replace(/<session-title>[\s\S]*?<\/session-title>\s*/, '');
}

export function generateSessionId(): string {
  return `agent-chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── AgentChatManager ──

const SWEEP_INTERVAL_MS = 60_000;
const COMPLETED_TTL_MS = 10 * 60 * 1000; // 10 minutes

class AgentChatManager {
  private runs = new Map<string, AgentChatRun>(); // key: sessionId
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    if (this.sweepTimer && typeof this.sweepTimer === 'object' && 'unref' in this.sweepTimer) {
      this.sweepTimer.unref();
    }
  }

  /**
   * Start a new agent chat conversation or continue one for a session.
   */
  async start(
    sessionId: string,
    agentId: string,
    message: string,
    flowContext?: FlowContext,
    images?: ImageAttachment[],
  ): Promise<string> {
    // ── 内置 Agent 字段迁移（运行时双保险） ──
    // 与 /api/agents/route.ts 的 readAgents() 同逻辑。此处再做一次是因为
    // start() 直接读 agents.json，不经过 API 路由；如果用户从未调用过 GET /api/agents
    //（比如直接 POST /api/agent-chat），磁盘文件可能还没被补齐。
    const agentsData = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });
    const agent = agentsData.agents.find(a => a.id === agentId && !a.archived);
    if (!agent) {
      throw new Error('Agent not found or archived');
    }
    const defaultAgent = DEFAULT_AGENTS.find(a => a.id === agentId);
    if (defaultAgent) {
      for (const key of Object.keys(defaultAgent) as Array<keyof Agent>) {
        if (agent[key] === undefined && defaultAgent[key] !== undefined) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (agent as any)[key] = defaultAgent[key];
        }
      }
    }

    let existing = this.runs.get(sessionId);

    // Hydrate from disk if not in memory
    if (!existing) {
      const diskSession = await this.loadSession(sessionId);
      if (diskSession) {
        existing = {
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
        };
        this.runs.set(sessionId, existing);
      }
    }

    if (existing?.status === 'running') {
      throw new Error('This session is already running');
    }

    const isResume = !!existing?.claudeSessionId;
    const runId = `agent-chat-${agentId}-${Date.now()}`;

    // Build or reuse message history
    const messages = existing?.messages ?? [];
    const dataUrls = images?.map(img => `data:${img.mediaType};base64,${img.data}`);
    messages.push({ role: 'user', content: message, images: dataUrls?.length ? dataUrls : undefined });

    const run: AgentChatRun = {
      runId,
      sessionId,
      agentId,
      projectKey: flowContext?.projectKey ?? existing?.projectKey,
      process: null,
      status: 'running',
      events: [],
      listeners: new Set(),
      startedAt: Date.now(),
      assistantText: '',
      contentBlocks: [],
      toolCalls: [],
      claudeSessionId: existing?.claudeSessionId,
      sessionTitle: existing?.sessionTitle,
      messages,
    };

    this.runs.set(sessionId, run);

    // Build prompt
    let stdinContent: string;
    if (isResume) {
      stdinContent = message;
    } else if (flowContext) {
      stdinContent = await buildAgentChatPromptWithFlowContext(agent, message, flowContext);
    } else {
      stdinContent = await buildAgentChatPrompt(agent, message);
    }

    // Spawn Claude
    const resumeArgs = isResume
      ? ['--resume', existing!.claudeSessionId!]
      : [];

    // Write images to temp files and build --image args
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

    const chatEnv = await buildClaudeEnv();
    const chatModelArgs = await buildClaudeModelArgs();
    const chatMaxTurnsArgs = await buildClaudeMaxTurnsArgs();
    // Use 'executing' phase to allow full agent capabilities
    const chatPermArgs = await buildAgentPermissionArgs('executing', agent.capabilities);
    const chatToolArgs = buildAgentToolArgs(agent.capabilities);

    const claude = spawn('claude', [
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
      ...chatPermArgs,
      ...chatToolArgs,
      ...chatModelArgs,
      ...chatMaxTurnsArgs,
      ...resumeArgs,
      ...imageArgs,
    ], {
      cwd: process.cwd(),
      shell: false,  // 🔒 Security: disable shell to prevent command injection
      env: chatEnv,
    });
    run.process = claude;

    claude.stdin.write(stdinContent);
    claude.stdin.end();

    // Wire up stdout parsing
    const lineBuffer = new LineBuffer();
    const streamParser = new StreamParser();

    claude.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      const lines = lineBuffer.feed(text);
      for (const line of lines) {
        const events = streamParser.parse(line);
        for (const event of events) {
          this.trackAndEmit(run, event);
        }
      }
    });

    claude.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      if (text.includes('Error') || text.includes('error')) {
        this.trackAndEmit(run, { type: 'error', message: text.trim() });
      }
    });

    claude.on('close', async (code) => {
      run.process = null;

      // Clean up temp image files
      for (const tmpPath of tempPaths) {
        unlink(tmpPath).catch(() => {});
      }

      // Flush remaining buffer
      const remaining = lineBuffer.flush();
      if (remaining) {
        const events = streamParser.parse(remaining);
        for (const event of events) {
          this.trackAndEmit(run, event);
        }
      }

      const aborted = run.status === 'stopped';

      if (code !== 0 && !run.assistantText && !aborted) {
        this.trackAndEmit(run, { type: 'error', message: `Claude exited with code ${code}` });
      }

      // Extract session title from first assistant response
      if (!run.sessionTitle && run.assistantText) {
        const aiTitle = extractSessionTitle(run.assistantText);
        const firstUserMsg = run.messages.find(m => m.role === 'user')?.content;
        run.sessionTitle = aiTitle
          ?? (firstUserMsg ? firstUserMsg.slice(0, 30) + '...' : '新会话');
      }

      // Parse and persist knowledge drafts before stripping tags
      if (run.assistantText) {
        const drafts = parseKnowledgeTags(run.assistantText);
        for (const draft of drafts) {
          const entryId = await createDraftContextEntry(draft, run.sessionId);
          if (entryId) {
            this.trackAndEmit(run, { type: 'knowledge_draft_created', entryId, label: draft.label });
          }
        }
      }

      // Save assistant message (strip title tag and knowledge tags)
      if (run.assistantText) {
        const cleaned = stripKnowledgeTags(stripSessionTitle(run.assistantText));
        run.messages.push({ role: 'assistant', content: cleaned });
      }

      // Capture session ID for resume
      if (streamParser.sessionId) {
        run.claudeSessionId = streamParser.sessionId;
      }

      // Persist to disk
      await this.persistSession(run);

      // Emit done
      this.trackAndEmit(run, { type: 'done' });
      if (run.status === 'running') {
        run.status = code === 0 ? 'completed' : 'failed';
      }
      run.completedAt = Date.now();
    });

    claude.on('error', async (err) => {
      this.trackAndEmit(run, { type: 'error', message: `Failed to spawn claude: ${err.message}` });
      this.trackAndEmit(run, { type: 'done' });
      run.status = 'failed';
      run.completedAt = Date.now();
      run.process = null;
      await this.persistSession(run);
    });

    return runId;
  }

  subscribe(
    sessionId: string,
    since: number,
    listener: (event: ChatSSEEvent, index: number) => void,
  ): (() => void) | null {
    const run = this.runs.get(sessionId);
    if (!run) return null;

    // Replay buffered events
    for (let i = since; i < run.events.length; i++) {
      listener(run.events[i], i);
    }

    if (run.status !== 'running') {
      return () => {};
    }

    run.listeners.add(listener);
    return () => {
      run.listeners.delete(listener);
    };
  }

  stop(sessionId: string): boolean {
    const run = this.runs.get(sessionId);
    if (!run || run.status !== 'running') return false;
    run.status = 'stopped';
    if (run.process) {
      run.process.kill('SIGTERM');
    }
    return true;
  }

  getStatus(sessionId: string): RunStatusInfo {
    const run = this.runs.get(sessionId);
    if (!run) {
      return { status: 'none', eventCount: 0 };
    }
    return {
      status: run.status,
      runId: run.runId,
      eventCount: run.events.length,
      startedAt: new Date(run.startedAt).toISOString(),
    };
  }

  getMessages(sessionId: string): Array<{ role: 'user' | 'assistant'; content: string }> {
    const run = this.runs.get(sessionId);
    if (!run) return [];
    return run.messages;
  }

  /**
   * Find a running session for a given agent (prevent concurrent runs).
   */
  getRunningForAgent(agentId: string): string | null {
    for (const [sessionId, run] of this.runs) {
      if (run.agentId === agentId && run.status === 'running') {
        return sessionId;
      }
    }
    return null;
  }

  /**
   * Find a running session for a given project (prevent concurrent runs).
   */
  getRunningForProject(projectKey: string): string | null {
    for (const [sessionId, run] of this.runs) {
      if (run.projectKey === projectKey && run.status === 'running') {
        return sessionId;
      }
    }
    return null;
  }

  /**
   * Clear the in-memory run for a session.
   */
  clear(sessionId: string): void {
    const run = this.runs.get(sessionId);
    if (run?.status === 'running') return;
    this.runs.delete(sessionId);
  }

  /**
   * Load a session from disk.
   */
  async loadSession(sessionId: string): Promise<AgentChatSession | null> {
    const data = await readJsonFile<AgentChatSessionsData>(
      getAgentChatSessionsPath(),
      DEFAULT_SESSIONS_DATA,
    );
    return data.sessions.find(s => s.id === sessionId) ?? null;
  }

  /**
   * List sessions for an agent (from disk).
   */
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

  /**
   * List sessions for an agent + project scope (from disk).
   */
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

  /**
   * List all sessions across all agents (from disk).
   */
  async listAllSessions(): Promise<Omit<AgentChatSession, 'messages'>[]> {
    const data = await readJsonFile<AgentChatSessionsData>(
      getAgentChatSessionsPath(),
      DEFAULT_SESSIONS_DATA,
    );
    return data.sessions
      .map(({ messages: _msgs, ...rest }) => rest)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  /**
   * Delete a session from disk.
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    this.clear(sessionId);
    let found = false;
    await modifyJsonFile<AgentChatSessionsData>(
      getAgentChatSessionsPath(),
      DEFAULT_SESSIONS_DATA,
      (data) => ({
        sessions: data.sessions.filter(s => {
          if (s.id === sessionId) { found = true; return false; }
          return true;
        }),
      }),
    );
    return found;
  }

  /**
   * Start a guest agent session.
   *
   * 旁听 Agent：独立进程，从宿主会话导入部分/全部轮次作为上下文。
   * 宿主 Agent 完全无感知 Guest 的存在。
   */
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

    // Load agent
    const agentsData = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });
    const agent = agentsData.agents.find(a => a.id === agentId && !a.archived);
    if (!agent) {
      throw new Error('Agent not found or archived');
    }
    const defaultAgent = DEFAULT_AGENTS.find(a => a.id === agentId);
    if (defaultAgent) {
      for (const key of Object.keys(defaultAgent) as Array<keyof Agent>) {
        if (agent[key] === undefined && defaultAgent[key] !== undefined) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (agent as any)[key] = defaultAgent[key];
        }
      }
    }

    // Check for existing guest run
    const existing = this.runs.get(guestSessionId);
    if (existing?.status === 'running') {
      throw new Error('This guest session is already running');
    }

    const isResume = !!existing?.claudeSessionId;
    const runId = `agent-chat-guest-${agentId}-${Date.now()}`;

    const messages = existing?.messages ?? [];
    messages.push({ role: 'user', content: message });

    const run: AgentChatRun = {
      runId,
      sessionId: guestSessionId,
      agentId,
      process: null,
      status: 'running',
      events: [],
      listeners: new Set(),
      startedAt: Date.now(),
      assistantText: '',
      contentBlocks: [],
      toolCalls: [],
      claudeSessionId: existing?.claudeSessionId,
      sessionTitle: existing?.sessionTitle,
      messages,
      parentSessionId,
      importedTurnIndices: turnIndices,
    };

    this.runs.set(guestSessionId, run);

    // Build prompt
    let stdinContent: string;
    if (isResume) {
      stdinContent = message;
    } else {
      stdinContent = await buildGuestAgentPrompt(agent, message, selectedTurns);
    }

    // Spawn Claude
    const resumeArgs = isResume
      ? ['--resume', existing!.claudeSessionId!]
      : [];

    const chatEnv = await buildClaudeEnv();
    const chatModelArgs = await buildClaudeModelArgs();
    const chatMaxTurnsArgs = await buildClaudeMaxTurnsArgs();
    const chatPermArgs = await buildAgentPermissionArgs('executing', agent.capabilities);
    const chatToolArgs = buildAgentToolArgs(agent.capabilities);

    const claude = spawn('claude', [
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
      ...chatPermArgs,
      ...chatToolArgs,
      ...chatModelArgs,
      ...chatMaxTurnsArgs,
      ...resumeArgs,
    ], {
      cwd: process.cwd(),
      shell: false,
      env: chatEnv,
    });
    run.process = claude;

    claude.stdin.write(stdinContent);
    claude.stdin.end();

    // Wire up stdout parsing (same as start())
    const lineBuffer = new LineBuffer();
    const streamParser = new StreamParser();

    claude.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      const lines = lineBuffer.feed(text);
      for (const line of lines) {
        const events = streamParser.parse(line);
        for (const event of events) {
          this.trackAndEmit(run, event);
        }
      }
    });

    claude.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      if (text.includes('Error') || text.includes('error')) {
        this.trackAndEmit(run, { type: 'error', message: text.trim() });
      }
    });

    claude.on('close', async (code) => {
      run.process = null;

      const remaining = lineBuffer.flush();
      if (remaining) {
        const events = streamParser.parse(remaining);
        for (const event of events) {
          this.trackAndEmit(run, event);
        }
      }

      const aborted = run.status === 'stopped';

      if (code !== 0 && !run.assistantText && !aborted) {
        this.trackAndEmit(run, { type: 'error', message: `Claude exited with code ${code}` });
      }

      if (!run.sessionTitle && run.assistantText) {
        const aiTitle = extractSessionTitle(run.assistantText);
        const firstUserMsg = run.messages.find(m => m.role === 'user')?.content;
        run.sessionTitle = aiTitle
          ?? (firstUserMsg ? firstUserMsg.slice(0, 30) + '...' : '旁听会话');
      }

      if (run.assistantText) {
        const drafts = parseKnowledgeTags(run.assistantText);
        for (const draft of drafts) {
          const entryId = await createDraftContextEntry(draft, run.sessionId);
          if (entryId) {
            this.trackAndEmit(run, { type: 'knowledge_draft_created', entryId, label: draft.label });
          }
        }
      }

      if (run.assistantText) {
        const cleaned = stripKnowledgeTags(stripSessionTitle(run.assistantText));
        run.messages.push({ role: 'assistant', content: cleaned });
      }

      if (streamParser.sessionId) {
        run.claudeSessionId = streamParser.sessionId;
      }

      await this.persistSession(run);
      this.trackAndEmit(run, { type: 'done' });
      if (run.status === 'running') {
        run.status = code === 0 ? 'completed' : 'failed';
      }
      run.completedAt = Date.now();
    });

    claude.on('error', async (err) => {
      this.trackAndEmit(run, { type: 'error', message: `Failed to spawn claude: ${err.message}` });
      this.trackAndEmit(run, { type: 'done' });
      run.status = 'failed';
      run.completedAt = Date.now();
      run.process = null;
      await this.persistSession(run);
    });

    return runId;
  }

  /**
   * List guest sessions for a given host session (from disk).
   */
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

  /**
   * Persist a run's session data to disk.
   */
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
      parentSessionId: run.parentSessionId,
      importedTurnIndices: run.importedTurnIndices,
    };

    await modifyJsonFile<AgentChatSessionsData>(
      getAgentChatSessionsPath(),
      DEFAULT_SESSIONS_DATA,
      (data) => {
        const idx = data.sessions.findIndex(s => s.id === run.sessionId);
        if (idx >= 0) {
          // Update existing — preserve original createdAt
          session.createdAt = data.sessions[idx].createdAt;
          data.sessions[idx] = session;
        } else {
          data.sessions.push(session);
        }
        return data;
      },
    );
  }

  private trackAndEmit(run: AgentChatRun, event: ChatSSEEvent): void {
    // Track
    if (event.type === 'text_delta') {
      run.assistantText += event.text;
      const last = run.contentBlocks[run.contentBlocks.length - 1];
      if (last && last.type === 'text') {
        last.text += event.text;
      } else {
        run.contentBlocks.push({ type: 'text', text: event.text });
      }
    } else if (event.type === 'tool_use_start') {
      const tc: ChatToolCall = {
        id: event.id,
        toolName: event.toolName,
        input: event.input,
        status: 'running',
      };
      run.toolCalls.push(tc);
      run.contentBlocks.push({ type: 'tool_call', toolCall: tc });
    } else if (event.type === 'tool_use_end') {
      const tc = run.toolCalls.find((t) => t.id === event.id);
      if (tc) {
        tc.output = event.output;
        tc.status = event.status;
      }
    }

    // Emit
    const index = run.events.length;
    run.events.push(event);
    for (const listener of run.listeners) {
      try {
        listener(event, index);
      } catch {
        // Listener may have been cleaned up
      }
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, run] of this.runs) {
      if (
        run.status !== 'running' &&
        run.completedAt &&
        now - run.completedAt > COMPLETED_TTL_MS
      ) {
        this.runs.delete(key);
      }
    }
  }
}

// ── Knowledge Tag Helpers ──

interface KnowledgeTag {
  label: string;
  description: string;
  format: 'json' | 'markdown' | 'text';
  content: string;
}

function parseKnowledgeTags(text: string): KnowledgeTag[] {
  const regex = /<save-knowledge\s+label="([^"]+)"\s+description="([^"]+)"\s+format="(text|json|markdown)">([\s\S]*?)<\/save-knowledge>/g;
  const results: KnowledgeTag[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    results.push({
      label: match[1].trim(),
      description: match[2].trim(),
      format: match[3] as 'json' | 'markdown' | 'text',
      content: match[4].trim(),
    });
  }
  return results;
}

function stripKnowledgeTags(text: string): string {
  return text.replace(/<save-knowledge[\s\S]*?<\/save-knowledge>/g, '').trim();
}

async function createDraftContextEntry(draft: KnowledgeTag, sessionId: string): Promise<string | null> {
  try {
    const now = new Date().toISOString();
    const id = `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const extMap = { json: 'json', markdown: 'md', text: 'txt' };
    const fileName = `knowledge-${id}.${extMap[draft.format]}`;

    const entry: ContextEntry = {
      id,
      label: draft.label,
      description: draft.description,
      fileName,
      format: draft.format,
      status: 'draft',
      sourceAgentSessionId: sessionId,
      producedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    const contextDir = getContextDir();
    await mkdir(contextDir, { recursive: true });
    await writeFile(getContextFilePath(fileName), draft.content, 'utf-8');

    await modifyJsonFile<ContextIndexData>(
      getContextIndexPath(),
      { entries: [] },
      (data) => { data.entries.push(entry); return data; },
    );

    return id;
  } catch (err) {
    console.error('[AgentChatManager] Failed to create draft context entry:', err);
    return null;
  }
}

// ── Context Index Builder ──
//
// 架构约束（详见 docs/context-system.md）：
// - 只注入索引（元数据），不注入内容文件 → 控制 token 用量
// - Agent 通过 description 判断需要哪个上下文，再用 bash cat 按需读取内容
// - buildAgentChatPrompt 和 buildAgentChatPromptWithFlowContext 都必须调用此函数
//   遗漏任何一个会导致该场景下 agent 看不到上下文索引

async function buildContextSection(): Promise<string> {
  const data = await readJsonFile<ContextIndexData>(getContextIndexPath(), { entries: [] });
  // 只注入已生效的条目（草稿不可见，避免误导 Agent）
  const activeEntries = data.entries.filter(e => !e.status || e.status === 'active');
  if (activeEntries.length === 0) return '';

  const tableHeader = '| 标签 | 描述 | 文件路径 | 原始文件路径 |\n|------|------|---------|------------|';
  const toRow = (e: { label: string; description: string; fileName: string; sourcePath?: string }) => {
    const filePath = getContextFilePath(e.fileName);
    const sourceCol = e.sourcePath ? `\`${e.sourcePath}\`` : '-';
    return `| ${e.label} | ${e.description} | \`${filePath}\` | ${sourceCol} |`;
  };

  const groups = [...new Set(activeEntries.map(e => e.group).filter((g): g is string => !!g))].sort();
  const ungrouped = activeEntries.filter(e => !e.group);

  let md = '\n\n## 可用上下文信息\n\n以下是用户配置的上下文信息索引。需要时可通过 bash 的 cat 命令读取具体文件内容。\n';

  if (ungrouped.length > 0) {
    md += `\n${tableHeader}\n${ungrouped.map(toRow).join('\n')}\n`;
  }

  for (const group of groups) {
    const groupEntries = data.entries.filter(e => e.group === group);
    md += `\n### ${group}\n${tableHeader}\n${groupEntries.map(toRow).join('\n')}\n`;
  }

  return md;
}

// ── Knowledge Saving Instructions ──

const KNOWLEDGE_SAVE_INSTRUCTIONS = `
## 知识保存

当你完成了调查、分析或研究，并产出了具有**长期复用价值**的知识（如数据库结构、API 文档、系统架构、配置清单等），你可以将这些知识以如下格式嵌入到你的回复中，系统会自动将其保存为草稿上下文条目，供用户确认后复用：

<save-knowledge label="知识标题（简短）" description="一句话描述，帮助 AI 决定是否需要读取" format="text">
知识内容...
</save-knowledge>

注意：
- format 只能是 text、json、markdown 之一
- 只在知识具有长期复用价值时使用，不要滥用
- 一次对话中最多保存 3 条知识
- 知识将以草稿状态保存，用户确认后才会生效`;

// ── Prompt Builder ──

async function buildAgentChatPrompt(agent: Agent, message: string): Promise<string> {
  const systemPrompt = agent.systemPrompt
    || `你是一个名为「${agent.name}」的 AI 助手。${agent.description || ''}`;

  const contextSection = await buildContextSection();

  return `${systemPrompt}${contextSection}${KNOWLEDGE_SAVE_INSTRUCTIONS}

## 会话标题

在你的**第一条回复的开头**，用以下格式生成一个简短的会话标题（5-15 个字，概括这次对话的主题）：

<session-title>标题内容</session-title>

之后的回复不需要再输出标题。

---

用户消息：${message}`;
}

// ── Flow-aware Prompt Builder ──

async function buildAgentChatPromptWithFlowContext(
  agent: Agent,
  message: string,
  flowContext: FlowContext,
): Promise<string> {
  const { projectKey, projectName, flowDataPath } = flowContext;

  const systemPrompt = agent.systemPrompt
    || `你是一个名为「${agent.name}」的 AI 助手。${agent.description || ''}`;

  const contextSection = await buildContextSection();

  return `${systemPrompt}${contextSection}${KNOWLEDGE_SAVE_INSTRUCTIONS}

## 当前项目上下文

你正在协助管理项目「${projectName}」（key: ${projectKey}）。

项目数据文件位置：${flowDataPath}

该文件是 JSON 格式，结构为 { "sections": [...] }，每个 section 包含 id、name、description、items 数组。每个 item 包含 id、content、status（todo/doing/done）、description、children（嵌套子项）等字段。

你可以直接读取和修改这个文件来管理项目结构。修改后确保 JSON 格式正确。

## 会话标题

在你的**第一条回复的开头**，用以下格式生成一个简短的会话标题（5-15 个字，概括这次对话的主题）：

<session-title>标题内容</session-title>

之后的回复不需要再输出标题。

---

用户消息：${message}`;
}

// ── Guest Agent Prompt Builder ──

async function buildGuestAgentPrompt(
  agent: Agent,
  message: string,
  importedTurns: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<string> {
  const systemPrompt = agent.systemPrompt
    || `你是一个名为「${agent.name}」的 AI 助手。${agent.description || ''}`;

  const contextSection = await buildContextSection();

  // Format imported turns as reference context
  let referenceSection = '';
  if (importedTurns.length > 0) {
    const turnsText = importedTurns.map((t, i) => {
      const roleLabel = t.role === 'user' ? '用户' : 'AI';
      return `### 轮次 ${i + 1}（${roleLabel}）\n${t.content}`;
    }).join('\n\n');

    referenceSection = `

## 参考对话

以下是来自另一个 AI 会话的对话记录，用户希望你基于这些内容进行讨论（如讲解、分析等）。
这些内容仅供参考，你不需要继续执行其中的操作。

${turnsText}
`;
  }

  return `${systemPrompt}${contextSection}${referenceSection}

## 会话标题

在你的**第一条回复的开头**，用以下格式生成一个简短的会话标题（5-15 个字，概括这次对话的主题）：

<session-title>标题内容</session-title>

之后的回复不需要再输出标题。

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
