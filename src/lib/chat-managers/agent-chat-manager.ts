/**
 * AgentChatManager — Lightweight Claude subprocess manager for Agent conversations.
 *
 * Extends BaseChatManager with:
 * - Multi-session support (sessionId-indexed)
 * - Image attachment handling (temp files + --image args)
 * - AI-generated session titles (<session-title> tag)
 * - Knowledge draft extraction (<save-knowledge> tag)
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
import type { ChatSSEEvent, ContentBlock, Agent, AgentsData } from '@/types';
import type { AgentChatSession, AgentChatSessionsData } from '@/types/agent-chat';
import { DEFAULT_AGENTS } from '@/lib/default-agents';

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

    // Build prompt
    let stdinContent: string;
    if (isResume) {
      stdinContent = message;
    } else if (flowContext) {
      stdinContent = await buildAgentChatPromptWithFlowContext(agent, message, flowContext);
    } else {
      stdinContent = await buildAgentChatPrompt(agent, message);
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

    // Save assistant message (strip title + knowledge tags)
    if (run.assistantText) {
      const cleaned = stripKnowledgeTags(stripSessionTitle(run.assistantText));
      // Also clean contentBlocks text entries
      const cleanedBlocks = run.contentBlocks.map(block => {
        if (block.type === 'text') {
          return { ...block, text: stripKnowledgeTags(stripSessionTitle(block.text)) };
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
          data.sessions[idx] = session;
        } else {
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

// ── Context Index Builder ──

async function buildContextSection(): Promise<string> {
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

// ── Preloaded Context Builder ──

async function buildPreloadedContextSection(contextIds: string[] | undefined): Promise<string> {
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
    } catch {
      // File missing or unreadable — skip silently
    }
  }

  if (sections.length === 0) return '';

  return `\n\n## Agent 预加载上下文\n\n以下上下文已由配置自动加载，无需手动读取：\n\n${sections.join('\n\n---\n\n')}\n`;
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

// ── Prompt Builders ──

async function buildAgentChatPrompt(agent: Agent, message: string): Promise<string> {
  const systemPrompt = agent.systemPrompt
    || `你是一个名为「${agent.name}」的 AI 助手。${agent.description || ''}`;

  const contextSection = await buildContextSection();
  const preloadedSection = await buildPreloadedContextSection(agent.contextIds);

  return `${systemPrompt}${contextSection}${preloadedSection}${KNOWLEDGE_SAVE_INSTRUCTIONS}

## 会话标题

在你的**第一条回复的开头**，用以下格式生成一个简短的会话标题（5-15 个字，概括这次对话的主题）：

<session-title>标题内容</session-title>

之后的回复不需要再输出标题。

---

用户消息：${message}`;
}

async function buildAgentChatPromptWithFlowContext(
  agent: Agent,
  message: string,
  flowContext: FlowContext,
): Promise<string> {
  const { projectKey, projectName, flowDataPath } = flowContext;

  const systemPrompt = agent.systemPrompt
    || `你是一个名为「${agent.name}」的 AI 助手。${agent.description || ''}`;

  const contextSection = await buildContextSection();
  const preloadedSection = await buildPreloadedContextSection(agent.contextIds);

  return `${systemPrompt}${contextSection}${preloadedSection}${KNOWLEDGE_SAVE_INSTRUCTIONS}

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

async function buildGuestAgentPrompt(
  agent: Agent,
  message: string,
  importedTurns: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<string> {
  const systemPrompt = agent.systemPrompt
    || `你是一个名为「${agent.name}」的 AI 助手。${agent.description || ''}`;

  const contextSection = await buildContextSection();
  const preloadedSection = await buildPreloadedContextSection(agent.contextIds);

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

  return `${systemPrompt}${contextSection}${preloadedSection}${referenceSection}

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
