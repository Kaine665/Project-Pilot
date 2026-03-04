/**
 * AgentChatManager — Lightweight Claude subprocess manager for Agent conversations.
 *
 * Extends BaseChatManager with:
 * - Multi-session support (sessionId-indexed)
 * - Image attachment handling (temp files + --image args)
 * - AI-generated session titles (<session-title> tag)
 * - Knowledge draft extraction (<save-knowledge> tag)
 * - Design doc extraction (<save-doc> tag)
 * - Guest Agent (spectator mode with imported turns)
 * - Session CRUD (list, load, delete, persisted to agent-chat-sessions.json)
 */

import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
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
  getContextIndexPath,
  getContextFilePath,
  getContextDir,
  getDesignDocsDir,
  getDesignDocsIndexPath,
  getDesignDocFilePath,
  readJsonFile,
  modifyJsonFile,
} from '@/lib/file-store';
import { resolveSystemPrompt } from '@/lib/agent-prompt-store';
import type { ContextIndexData, ContextEntry, DocsIndexData, DocEntry } from '@/types';
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
import '@/lib/resource-loaders'; // side-effect: registers all loaders
import { migrateAgentToResources } from '@/lib/resource-migration';
import type { SystemPromptLoaderContext } from '@/lib/resource-loaders/system-prompt-loader';

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

    // Build or reuse message history
    const messages = existing?.messages ?? [];
    const dataUrls = images?.map(img => `data:${img.mediaType};base64,${img.data}`);
    messages.push({ role: 'user', content: message, images: dataUrls?.length ? dataUrls : undefined });

    // Resolve session config: initialConfig (from API) > existing run/disk config
    const sessionConfig = initialConfig ?? existing?.config;

    // Build prompt
    let stdinContent: string;
    if (isResume) {
      stdinContent = message;
    } else if (flowContext) {
      stdinContent = await buildAgentChatPromptWithFlowContext(agent, message, flowContext, sessionConfig);
    } else {
      stdinContent = await buildAgentChatPrompt(agent, message, sessionConfig);
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

    const config: SpawnConfig = {
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
    };

    // Attach domain data via a closure — createRun will capture these
    this._pendingStartData = {
      sessionId,
      agentId,
      projectKey: flowContext?.projectKey ?? existing?.projectKey,
      sessionTitle: existing?.sessionTitle ?? initialTitle,
      messages,
      tempPaths,
      config: sessionConfig,
    };

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
    const messages = existing?.messages ?? [];
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

    const config: SpawnConfig = {
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
    };

    this._pendingStartData = {
      sessionId: guestSessionId,
      agentId,
      sessionTitle: existing?.sessionTitle,
      messages,
      tempPaths: [],
      parentSessionId,
      importedTurnIndices: turnIndices,
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

  /**
   * Temporary holder for domain data between start() and createRun().
   * This avoids passing domain data through SpawnConfig generics.
   */
  private _pendingStartData!: {
    sessionId: string;
    agentId: string;
    projectKey?: string;
    sessionTitle?: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string; images?: string[]; contentBlocks?: ContentBlock[] }>;
    tempPaths: string[];
    config?: SessionConfig;
    parentSessionId?: string;
    importedTurnIndices?: number[];
  };

  protected createRun(config: SpawnConfig, shell: BaseRun): AgentChatRun {
    const d = this._pendingStartData;
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

    // Extract session title
    if (!run.sessionTitle && run.assistantText) {
      const aiTitle = extractSessionTitle(run.assistantText);
      const firstUserMsg = run.messages.find(m => m.role === 'user')?.content;
      const defaultTitle = run.parentSessionId ? '旁听会话' : '新会话';
      run.sessionTitle = aiTitle
        ?? (firstUserMsg ? firstUserMsg.slice(0, 30) + '...' : defaultTitle);
    }

    // Parse and persist knowledge drafts
    if (run.assistantText) {
      const drafts = parseKnowledgeTags(run.assistantText);
      for (const draft of drafts) {
        const entryId = await createDraftContextEntry(draft, run.sessionId);
        if (entryId) {
          this.trackAndEmit(run, { type: 'knowledge_draft_created', entryId, label: draft.label });
        }
      }
    }

    // Parse and persist design doc drafts
    if (run.assistantText) {
      const docDrafts = parseDocTags(run.assistantText);
      for (const draft of docDrafts) {
        const docId = await createDesignDoc(draft);
        if (docId) {
          this.trackAndEmit(run, { type: 'doc_created', docId, title: draft.title, projectKey: draft.project });
        }
      }
    }

    // Save assistant message (strip title + knowledge tags + doc tags)
    if (run.assistantText) {
      const cleaned = stripDocTags(stripKnowledgeTags(stripSessionTitle(run.assistantText)));
      // Also clean contentBlocks text entries
      const cleanedBlocks = run.contentBlocks.map(block => {
        if (block.type === 'text') {
          return { ...block, text: stripDocTags(stripKnowledgeTags(stripSessionTitle(block.text))) };
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
    };
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
    console.error('[AgentChat] Failed to create draft context entry:', err);
    return null;
  }
}

// ── Design Doc Tag Helpers ──

interface DocTag {
  project: string;
  title: string;
  description: string;
  content: string;
}

function parseDocTags(text: string): DocTag[] {
  const regex = /<save-doc\s+project="([^"]+)"\s+title="([^"]+)"\s+description="([^"]+)">([\s\S]*?)<\/save-doc>/g;
  const results: DocTag[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    results.push({
      project: match[1].trim(),
      title: match[2].trim(),
      description: match[3].trim(),
      content: match[4].trim(),
    });
  }
  return results;
}

function stripDocTags(text: string): string {
  return text.replace(/<save-doc[\s\S]*?<\/save-doc>/g, '').trim();
}

async function createDesignDoc(draft: DocTag): Promise<string | null> {
  try {
    const now = new Date().toISOString();
    const docId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const fileName = `${docId}.md`;

    const entry: DocEntry = {
      id: docId,
      title: draft.title,
      description: draft.description,
      fileName,
      projectKey: draft.project,
      createdAt: now,
      updatedAt: now,
    };

    const docsDir = getDesignDocsDir();
    await mkdir(docsDir, { recursive: true });
    await writeFile(getDesignDocFilePath(fileName), draft.content, 'utf-8');

    await modifyJsonFile<DocsIndexData>(
      getDesignDocsIndexPath(),
      { projects: {} },
      (data) => {
        if (!data.projects[entry.projectKey]) {
          data.projects[entry.projectKey] = [];
        }
        data.projects[entry.projectKey].push(entry);
        return data;
      },
    );

    return docId;
  } catch (err) {
    console.error('[AgentChat] Failed to create design doc:', err);
    return null;
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

  const ctx: SystemPromptLoaderContext = {
    agentId: agent.id,
    systemPromptText,
    // exposePromptPath: pass prompt file path if the agent opts in
    promptFilePath: agent.capabilities?.exposePromptPath ? getPromptFilePath(agent.id) : undefined,
  };

  const resolvedResources = await resourceRegistry.resolveAll(allRefs, ctx);
  return resourceRegistry.formatAsPrompt(resolvedResources);
}

// ── Prompt Builders (powered by Resource Registry) ──

async function buildAgentChatPrompt(agent: Agent, message: string, sessionConfig?: SessionConfig): Promise<string> {
  const resourcePrompt = await buildResourcePrompt(agent, undefined, sessionConfig);

  return `${resourcePrompt}

---

用户消息：${message}`;
}

async function buildAgentChatPromptWithFlowContext(
  agent: Agent,
  message: string,
  flowContext: FlowContext,
  sessionConfig?: SessionConfig,
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

  const resourcePrompt = await buildResourcePrompt(agent, [flowRef], sessionConfig);

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

// ── Legacy Helpers (deprecated — kept for reference, no longer called) ──

/** @deprecated Use buildResourcePrompt() instead */
async function _legacyBuildContextSection(): Promise<string> {
  const data = await readJsonFile<ContextIndexData>(getContextIndexPath(), { entries: [] });
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

/** @deprecated Use buildResourcePrompt() instead */
async function _legacyBuildPreloadedContextSection(contextIds: string[] | undefined): Promise<string> {
  if (!contextIds || contextIds.length === 0) return '';
  const data = await readJsonFile<ContextIndexData>(getContextIndexPath(), { entries: [] });
  const entries = data.entries.filter(e => contextIds.includes(e.id) && (!e.status || e.status === 'active'));
  if (entries.length === 0) return '';
  const sections: string[] = [];
  for (const entry of entries) {
    try {
      const filePath = getContextFilePath(entry.fileName);
      const content = await readFile(filePath, 'utf-8');
      sections.push(`### ${entry.label}\n\n${content.trim()}`);
    } catch { /* skip */ }
  }
  if (sections.length === 0) return '';
  return `\n\n## Agent 预加载上下文\n\n以下上下文已由配置自动加载，无需手动读取：\n\n${sections.join('\n\n---\n\n')}\n`;
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
