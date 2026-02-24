/**
 * PlannerManager — 轻量级 Claude 子进程管理器，用于 AI 规划助手。
 *
 * 与 ProcessManager 的区别：
 * - 按 sessionId 索引（支持多会话）
 * - 无阶段管理、无产物提取、无 git 管理
 * - 会话持久化到 data/planner-sessions.json
 * - 支持 --resume 多轮对话
 */

import { spawn, type ChildProcess } from 'child_process';
import { StreamParser, LineBuffer } from '@/lib/claude-stream-parser';
import {
  getPlannerSessionsPath,
  readJsonFile,
  modifyJsonFile,
} from '@/lib/file-store';
import { buildClaudeEnv, buildClaudeModelArgs, buildClaudeMaxTurnsArgs, buildClaudePermissionArgs } from '@/lib/settings-manager';
import type { ChatSSEEvent, ChatToolCall, ContentBlock } from '@/types';
import type { FlowData } from '@/types/flow';
import type { PlannerSession, PlannerSessionsData } from '@/types/planner';

// ── Types ──

export type RunStatus = 'running' | 'completed' | 'failed' | 'stopped';

export interface PlannerRun {
  runId: string;
  sessionId: string;
  projectKey: string;
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
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface RunStatusInfo {
  status: RunStatus | 'none';
  runId?: string;
  eventCount: number;
  startedAt?: string;
}

// ── Helpers ──

const DEFAULT_SESSIONS_DATA: PlannerSessionsData = { sessions: [] };

function extractSessionTitle(text: string): string | null {
  const match = text.match(/<session-title>([\s\S]*?)<\/session-title>/);
  return match ? match[1].trim() : null;
}

function stripSessionTitle(text: string): string {
  return text.replace(/<session-title>[\s\S]*?<\/session-title>\s*/, '');
}

export function generateSessionId(): string {
  return `planner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── PlannerManager ──

const SWEEP_INTERVAL_MS = 60_000;
const COMPLETED_TTL_MS = 10 * 60 * 1000; // 10 minutes

class PlannerManager {
  private runs = new Map<string, PlannerRun>(); // key: sessionId
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    if (this.sweepTimer && typeof this.sweepTimer === 'object' && 'unref' in this.sweepTimer) {
      this.sweepTimer.unref();
    }
  }

  /**
   * Start a new planner conversation or continue one for a session.
   */
  async start(
    sessionId: string,
    projectKey: string,
    message: string,
    flowData: FlowData,
    projects: Array<{ key: string; name: string }>,
  ): Promise<string> {
    // Check if any session is already running for this project
    const runningId = this.getRunningForProject(projectKey);
    if (runningId && runningId !== sessionId) {
      throw new Error('A planner process is already running for this project');
    }

    let existing = this.runs.get(sessionId);

    // Hydrate from disk if not in memory
    if (!existing) {
      const diskSession = await this.loadSession(sessionId);
      if (diskSession) {
        existing = {
          runId: '',
          sessionId: diskSession.id,
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
    const runId = `planner-${projectKey}-${Date.now()}`;

    // Build or reuse message history
    const messages = existing?.messages ?? [];
    messages.push({ role: 'user', content: message });

    const run: PlannerRun = {
      runId,
      sessionId,
      projectKey,
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
    } else {
      stdinContent = buildPlannerPrompt(projectKey, flowData, projects, message);
    }

    // Spawn Claude
    const resumeArgs = isResume
      ? ['--resume', existing!.claudeSessionId!]
      : [];

    const plannerEnv = await buildClaudeEnv();
    const plannerModelArgs = await buildClaudeModelArgs();
    const plannerMaxTurnsArgs = await buildClaudeMaxTurnsArgs();
    const plannerPermArgs = await buildClaudePermissionArgs('planning');
    const claude = spawn('claude', [
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
      ...plannerPermArgs,
      ...plannerModelArgs,
      ...plannerMaxTurnsArgs,
      ...resumeArgs,
    ], {
      cwd: process.cwd(),
      shell: false,  // 🔒 Security: disable shell to prevent command injection
      env: plannerEnv,
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

      // Save assistant message (strip title tag)
      if (run.assistantText) {
        const cleaned = stripSessionTitle(run.assistantText);
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
  async loadSession(sessionId: string): Promise<PlannerSession | null> {
    const data = await readJsonFile<PlannerSessionsData>(
      getPlannerSessionsPath(),
      DEFAULT_SESSIONS_DATA,
    );
    return data.sessions.find(s => s.id === sessionId) ?? null;
  }

  /**
   * List sessions for a project (from disk).
   */
  async listSessions(projectKey: string): Promise<Omit<PlannerSession, 'messages'>[]> {
    const data = await readJsonFile<PlannerSessionsData>(
      getPlannerSessionsPath(),
      DEFAULT_SESSIONS_DATA,
    );
    return data.sessions
      .filter(s => s.projectKey === projectKey)
      .map(({ messages: _msgs, ...rest }) => rest)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  /**
   * Delete a session from disk.
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    this.clear(sessionId);
    let found = false;
    await modifyJsonFile<PlannerSessionsData>(
      getPlannerSessionsPath(),
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
   * Persist a run's session data to disk.
   */
  private async persistSession(run: PlannerRun): Promise<void> {
    const now = new Date().toISOString();
    const session: PlannerSession = {
      id: run.sessionId,
      projectKey: run.projectKey,
      title: run.sessionTitle ?? '新会话',
      messages: run.messages,
      claudeSessionId: run.claudeSessionId,
      createdAt: new Date(run.startedAt).toISOString(),
      updatedAt: now,
    };

    await modifyJsonFile<PlannerSessionsData>(
      getPlannerSessionsPath(),
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

  private trackAndEmit(run: PlannerRun, event: ChatSSEEvent): void {
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

// ── Prompt Builder ──

function buildPlannerPrompt(
  projectKey: string,
  flowData: FlowData,
  projects: Array<{ key: string; name: string }>,
  message: string,
): string {
  const currentProject = projects.find(p => p.key === projectKey);
  const projectName = currentProject?.name ?? projectKey;

  const flowSummary = JSON.stringify(flowData, null, 2);
  const projectList = projects.map(p => `- ${p.key}: ${p.name}`).join('\n');

  return `你是 ProjectPilot 的 AI 项目规划助手。你的任务是帮助用户规划项目任务结构。

## 你可以做的事

1. 分析用户的需求，建议在哪个板块（section）、哪个层级放置条目
2. 建议创建新的板块或条目
3. 分析现有项目结构的合理性，提出改进建议

## 会话标题

在你的**第一条回复的开头**，用以下格式生成一个简短的会话标题（5-15 个字，概括这次对话的主题）：

<session-title>标题内容</session-title>

之后的回复不需要再输出标题。

## 当前项目「${projectName}」的板块结构

\`\`\`json
${flowSummary}
\`\`\`

## 所有项目
${projectList}

## 输出格式

当你有具体建议时，在回复中用以下格式输出结构化建议（可以有多个）：

\`\`\`json:flow-suggestion
{
  "suggestions": [
    {
      "type": "add_section | add_item",
      "description": "简短描述这个建议做了什么",
      "target": {
        "sectionId": "目标板块ID（add_item 时需要）",
        "sectionName": "目标板块名称（用于显示）",
        "parentItemId": "父条目ID（嵌套添加时需要）",
        "parentItemContent": "父条目内容（用于显示）"
      },
      "payload": {
        "section": { "name": "板块名", "description": "描述", "items": [{"content": "条目内容", "description": "描述"}] },
        "item": { "content": "条目内容", "description": "描述" }
      }
    }
  ]
}
\`\`\`

**注意**：payload 中只需要填写对应 type 需要的字段。例如 type 为 "add_item" 时只需要 payload.item。

你也可以只用自然语言讨论，不一定每次都输出结构化建议。当用户明确想要添加内容时再输出建议。

## 对话规则

1. 用中文回复
2. 先理解用户需求再给建议
3. 给建议时说明理由（为什么放在这里、这样组织的好处）
4. 如果现有结构中有合适的位置，优先建议放入已有板块
5. 回复简洁有力，不要啰嗦

---

用户消息：${message}`;
}

// ── Singleton ──

const globalForPlanner = globalThis as unknown as {
  __plannerManager?: PlannerManager;
};

export const plannerManager =
  globalForPlanner.__plannerManager ?? new PlannerManager();

if (process.env.NODE_ENV !== 'production') {
  globalForPlanner.__plannerManager = plannerManager;
}
