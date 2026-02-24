/**
 * ProcessManager — Claude 子进程生命周期管理。
 *
 * 核心原则：进程生命周期由显式操作控制（start/stop），
 * 不与任何 HTTP 连接绑定。前端只是观察窗口。
 */

import { spawn, type ChildProcess } from 'child_process';
import {
  getConversationPath,
  getConversationFilePath,
  getConversationIndexPath,
  getTasksPath,
  getProjectsPath,
  getFlowDataPath,
  getTaskArtifactsPath,
  readJsonFile,
  writeJsonFile,
  modifyJsonFile,
} from '@/lib/file-store';
import {
  validateWorkingDir,
  validateBranchName,
  safeGitCheckout,
  safeGitCreateBranch,
  safeGitMerge,
  safeGitDeleteBranch,
  safeGitCurrentBranch,
  detectDefaultBranch as safeDetectDefaultBranch,
} from '@/lib/security';
import { ensureConversationIndex, updateConversationMeta } from '@/lib/conversation-migration';
import { buildPrompt, buildBranchingPrompt, type PromptContext } from '@/lib/prompt-builder';
import { buildClaudeEnv, buildClaudeModelArgs, buildClaudeMaxTurnsArgs, buildClaudePermissionArgs } from '@/lib/settings-manager';
import { StreamParser, LineBuffer } from '@/lib/claude-stream-parser';
import { extractPlanFromText, savePlan } from '@/lib/plan-extractor';
import {
  extractBranchSlugFromText,
  extractUnderstandingFromText,
  extractResultFromText,
  saveUnderstanding,
  saveResult,
} from '@/lib/artifact-extractor';
import type {
  Session,
  SessionPhase,
  ChatSession,
  ChatMessage,
  ChatSSEEvent,
  ChatToolCall,
  ContentBlock,
  ProjectsData,
  TaskArtifacts,
} from '@/types';
import type { FlowData, TreeItem, Status as FlowStatus } from '@/types/flow';
import { isLegacyFormat, migrateLegacyToSections } from '@/lib/flow-migration';
import type { FlowTaskContext } from '@/types/flow-context';
import { detectDangerousCommand } from '@/lib/danger-detector';

// ── Types ──

export type RunStatus = 'running' | 'completed' | 'failed' | 'stopped';

export interface ProcessRun {
  runId: string;
  taskId: string;
  conversationId: string;
  process: ChildProcess | null; // null after process exits
  status: RunStatus;
  events: ChatSSEEvent[];
  listeners: Set<(event: ChatSSEEvent, index: number) => void>;
  startedAt: number;
  completedAt?: number;

  // Accumulation (same role as trackBlock in the old route.ts)
  assistantText: string;
  contentBlocks: ContentBlock[];
  toolCalls: ChatToolCall[];

  // Conversation session reference
  session: ChatSession;
}

export interface RunStatusInfo {
  status: RunStatus | 'none';
  runId?: string;
  eventCount: number;
  startedAt?: string;
}

// ── Default factory ──

const DEFAULT_SESSION = (taskId: string, conversationId: string): ChatSession => ({
  sessionId: taskId,
  conversationId,
  messages: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

// ── ProcessManager ──

const SWEEP_INTERVAL_MS = 60_000;
const COMPLETED_TTL_MS = 5 * 60 * 1000; // 5 minutes

class ProcessManager {
  private runs = new Map<string, ProcessRun>();
  private retryCounts = new Map<string, number>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    // Allow the timer to not block process exit
    if (this.sweepTimer && typeof this.sweepTimer === 'object' && 'unref' in this.sweepTimer) {
      this.sweepTimer.unref();
    }
  }

  /**
   * Start a new Claude process for a task.
   * Returns runId on success.
   * Throws if a process is already running for this task.
   */
  async start(taskId: string, message: string, conversationId?: string): Promise<string> {
    const existing = this.runs.get(taskId);
    if (existing?.status === 'running') {
      throw new Error('A process is already running for this task');
    }

    // ── Load data ──
    // NOTE: Runtime data uses `tasks` key (pre-existing mismatch with SessionsData type)
    const tasksData = await readJsonFile<{ tasks: Session[] }>(getTasksPath(), { tasks: [] });
    const task = tasksData.tasks.find((t) => t.id === taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    const projectsData = await readJsonFile<ProjectsData>(getProjectsPath(), { projects: {} });
    const project = task.projectKey ? projectsData.projects[task.projectKey] ?? null : null;
    const workingDir = project?.path ?? process.cwd();

    // ── Phase 0: branching — one-shot branch name generation ──
    if (task.phase === 'branching') {
      return this.runBranchingPhase(taskId, task, workingDir, project?.defaultBranch);
    }

    // ── Resolve conversation ──
    const convIndex = await ensureConversationIndex(taskId);
    let effectiveConvId = conversationId;

    if (!effectiveConvId) {
      // 没有指定 conversationId → 使用活跃对话或创建新对话
      if (convIndex.activeConversationId) {
        effectiveConvId = convIndex.activeConversationId;
      } else {
        // 创建第一个对话
        effectiveConvId = `conv-${Date.now()}`;
        convIndex.conversations.push({
          conversationId: effectiveConvId,
          title: message.slice(0, 30) + (message.length > 30 ? '...' : ''),
          messageCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        convIndex.activeConversationId = effectiveConvId;
        await writeJsonFile(getConversationIndexPath(taskId), convIndex);
      }
    }

    // ── Load / init conversation ──
    const session = await readJsonFile<ChatSession>(
      getConversationFilePath(taskId, effectiveConvId),
      DEFAULT_SESSION(taskId, effectiveConvId),
    );

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };
    session.messages.push(userMsg);

    // ── Determine first turn vs resume ──
    // 优先从 conversation 级别读取 claudeSessionId，兼容旧数据从 task 级别读取
    const claudeSessionId = session.claudeSessionId ?? task.claudeSessionId;
    const isResume = !!claudeSessionId;
    let stdinContent: string;

    if (isResume) {
      // Resume: only send the new user message.
      // But prefix with phase transition note so Claude knows its current capabilities.
      const phaseNote = buildPhaseTransitionNote(task.phase);
      stdinContent = phaseNote ? `${phaseNote}\n\n${message}` : message;
    } else {
      // First turn: build full prompt with system instructions + context
      const promptCtx: PromptContext = {
        task,
        project,
        history: session.messages.slice(0, -1),
        newMessage: message,
        detectedBaseBranch: (() => { try { return this.detectDefaultBranch(workingDir); } catch { return undefined; } })(),
      };
      stdinContent = buildPrompt(promptCtx);
    }

    // Save user message immediately (so it survives crashes)
    session.updatedAt = new Date().toISOString();
    await writeJsonFile(getConversationFilePath(taskId, effectiveConvId), session);

    // ── Create ProcessRun ──
    const runId = `run-${taskId}-${Date.now()}`;
    const run: ProcessRun = {
      runId,
      taskId,
      conversationId: effectiveConvId,
      process: null,
      status: 'running',
      events: [],
      listeners: new Set(),
      startedAt: Date.now(),
      assistantText: '',
      contentBlocks: [],
      toolCalls: [],
      session,
    };

    // Replace any previous completed run
    this.runs.set(taskId, run);

    // ── Spawn Claude (phase-based permissions + optional resume) ──
    // Validate working directory first
    try {
      validateWorkingDir(workingDir);
    } catch (err) {
      throw new Error(`Invalid working directory: ${err instanceof Error ? err.message : String(err)}`);
    }

    const permissionArgs = await buildClaudePermissionArgs(task.phase);
    const resumeArgs = isResume
      ? ['--resume', claudeSessionId!]
      : [];
    const claudeEnv = await buildClaudeEnv();
    const modelArgs = await buildClaudeModelArgs();
    const maxTurnsArgs = await buildClaudeMaxTurnsArgs();
    const claude = spawn('claude', [
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
      ...modelArgs,
      ...maxTurnsArgs,
      ...permissionArgs,
      ...resumeArgs,
    ], {
      cwd: workingDir,
      shell: false,  // 🔒 Security: disable shell to prevent command injection
      env: claudeEnv,
    });
    run.process = claude;

    // Write prompt (first turn) or just user message (resume) via stdin
    claude.stdin.write(stdinContent);
    claude.stdin.end();

    // ── Sync flow task status → doing ──
    this.syncFlowTaskStatus(task.flowContext, 'doing');

    // ── Auto-status: todo → doing ──
    if (task.status === 'todo') {
      await modifyJsonFile<{ tasks: Session[] }>(getTasksPath(), { tasks: [] }, (data) => {
        const t = data.tasks.find((t) => t.id === taskId);
        if (t && t.status === 'todo') {
          t.status = 'doing';
          t.updatedAt = new Date().toISOString();
        }
        return data;
      });
    }

    // ── Wire up stdout parsing ──
    const lineBuffer = new LineBuffer();
    const streamParser = new StreamParser();

    claude.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      const lines = lineBuffer.feed(text);

      if (lines.length > 0) {
        console.log(`[PM] stdout: ${lines.length} lines, first: ${lines[0].slice(0, 80)}...`);
      }

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

    // ── Handle process exit ──
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

      // Save assistant message to conversation
      if (run.assistantText || run.contentBlocks.length > 0) {
        const assistantMsg: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: run.assistantText,
          timestamp: new Date().toISOString(),
          toolCalls: run.toolCalls.length > 0 ? [...run.toolCalls] : undefined,
          contentBlocks: run.contentBlocks.length > 0 ? [...run.contentBlocks] : undefined,
          interrupted: aborted || undefined,
        };

        // Extract artifacts only if not aborted
        if (!aborted) {
          const planData = extractPlanFromText(run.assistantText);
          if (planData) {
            try {
              const planId = await savePlan(taskId, planData);
              assistantMsg.extractedPlanId = planId;
              this.trackAndEmit(run, { type: 'plan_extracted', planId });
            } catch (err) {
              console.error('Failed to extract plan:', err);
            }
          }

          const understanding = extractUnderstandingFromText(run.assistantText);
          if (understanding) {
            try {
              await saveUnderstanding(taskId, understanding);
              this.trackAndEmit(run, { type: 'understanding_extracted', understanding });
            } catch (err) {
              console.error('Failed to extract understanding:', err);
            }
          }

          const result = extractResultFromText(run.assistantText);
          if (result) {
            try {
              await saveResult(taskId, result);
              this.trackAndEmit(run, { type: 'result_extracted', result });
            } catch (err) {
              console.error('Failed to extract result:', err);
            }

            // 自动合并分支回主分支，但不标记完成——用户需自行验证后手动完成
            if (result.status === 'completed') {
              await this.autoMergeBranch(taskId, workingDir, project?.defaultBranch, run);
            }
          }

          // Save Claude session ID to conversation level (not task level)
          const newClaudeSessionId = streamParser.sessionId ?? undefined;
          if (newClaudeSessionId) {
            run.session.claudeSessionId = newClaudeSessionId;
          }

          // ── Update task: auto-advance phase ──
          await this.postTurnUpdate(taskId, task.phase, {
            hasUnderstanding: !!understanding,
            hasPlan: !!planData,
            hasResult: !!result,
            activeConversationId: run.conversationId,
          });

          // ── Check retry: did AI produce expected artifact for current phase? ──
          this.checkAndEmitRetry(run, taskId, task.phase, {
            hasUnderstanding: !!understanding,
            hasPlan: !!planData,
            hasResult: !!result,
          });
        }

        run.session.messages.push(assistantMsg);
        run.session.updatedAt = new Date().toISOString();
        await writeJsonFile(getConversationFilePath(taskId, run.conversationId), run.session);

        // Update conversation index metadata
        await updateConversationMeta(taskId, run.conversationId, {
          messageCount: run.session.messages.length,
          updatedAt: run.session.updatedAt,
          claudeSessionId: run.session.claudeSessionId,
          // Update title from first user message if still default
          ...(run.session.messages.length <= 2 ? {
            title: (() => {
              const firstUser = run.session.messages.find((m) => m.role === 'user');
              return firstUser
                ? firstUser.content.slice(0, 30) + (firstUser.content.length > 30 ? '...' : '')
                : '新对话';
            })(),
          } : {}),
        });
      }

      // Emit done and update status
      this.trackAndEmit(run, { type: 'done' });
      if (run.status === 'running') {
        run.status = code === 0 ? 'completed' : 'failed';
      }
      run.completedAt = Date.now();
    });

    claude.on('error', (err) => {
      this.trackAndEmit(run, { type: 'error', message: `Failed to spawn claude: ${err.message}` });
      this.trackAndEmit(run, { type: 'done' });
      run.status = 'failed';
      run.completedAt = Date.now();
      run.process = null;
    });

    return runId;
  }

  /**
   * Subscribe to events for a task.
   * Replays events from `since` index, then streams new events.
   * Returns unsubscribe function, or null if no run exists.
   */
  subscribe(
    taskId: string,
    since: number,
    listener: (event: ChatSSEEvent, index: number) => void,
  ): (() => void) | null {
    const run = this.runs.get(taskId);
    if (!run) return null;

    // Replay buffered events
    for (let i = since; i < run.events.length; i++) {
      listener(run.events[i], i);
    }

    // If already done, no need for live subscription
    if (run.status !== 'running') {
      return () => {};
    }

    // Add live listener
    run.listeners.add(listener);
    return () => {
      run.listeners.delete(listener);
    };
  }

  /**
   * Stop a running process explicitly.
   */
  stop(taskId: string): boolean {
    const run = this.runs.get(taskId);
    if (!run || run.status !== 'running') return false;
    run.status = 'stopped';
    if (run.process) {
      run.process.kill('SIGTERM');
    }
    return true;
  }

  /**
   * Get the conversationId of the current/last run for a task.
   */
  getRunConversationId(taskId: string): string | undefined {
    return this.runs.get(taskId)?.conversationId || undefined;
  }

  /**
   * Get run info for a task.
   */
  getStatus(taskId: string): RunStatusInfo {
    const run = this.runs.get(taskId);
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

  /**
   * Auto-merge git branch back to default branch (but do NOT mark session as done).
   * User must verify the build and manually mark completion.
   */
  private async autoMergeBranch(
    taskId: string,
    workingDir: string,
    defaultBranch: string | undefined,
    run: ProcessRun,
  ): Promise<void> {
    try {
      // Validate working directory
      validateWorkingDir(workingDir);

      // Reload task to get latest gitBranch (may have been set during execution)
      const tasksData = await readJsonFile<{ tasks: Session[] }>(getTasksPath(), { tasks: [] });
      const task = tasksData.tasks.find((t) => t.id === taskId);
      if (!task?.gitBranch) return;

      const gitBranch = task.gitBranch;
      const targetBranch = defaultBranch ?? this.detectDefaultBranch(workingDir);

      // Validate branch names
      validateBranchName(gitBranch);
      validateBranchName(targetBranch);

      // Checkout target branch
      safeGitCheckout(targetBranch, workingDir);
      // Merge task branch
      safeGitMerge(gitBranch, workingDir, `Merge task branch ${gitBranch}`);

      // Delete merged branch (best-effort)
      try {
        safeGitDeleteBranch(gitBranch, workingDir);
      } catch {
        // Ignore deletion failures
      }

      console.log(`[PM] Auto-merged ${gitBranch} → ${targetBranch}`);
      this.trackAndEmit(run, {
        type: 'branch_merged',
        branch: gitBranch,
        targetBranch,
      });

      // Clear gitBranch reference (branch is merged and deleted)
      await modifyJsonFile<{ tasks: Session[] }>(getTasksPath(), { tasks: [] }, (data) => {
        const t = data.tasks.find((t) => t.id === taskId);
        if (t) {
          t.gitBranch = undefined;
          t.updatedAt = new Date().toISOString();
        }
        return data;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[PM] Auto-merge failed:`, msg);
      this.trackAndEmit(run, {
        type: 'error',
        message: `自动合并失败：${msg}`,
      });
    }
  }

  /**
   * Create a git branch for task execution. Returns branch name, or null on failure.
   * Branch name format: task/{shortId}-{slug} — unique per taskId.
   */
  private createTaskBranch(
    taskId: string,
    title: string,
    workingDir: string,
    defaultBranch?: string,
    branchSlug?: string,
  ): string | null {
    try {
      // Validate working directory first
      validateWorkingDir(workingDir);

      const branch = generateBranchName(taskId, title, branchSlug);
      const baseBranch = defaultBranch ?? this.detectDefaultBranch(workingDir);

      // Validate branch names
      validateBranchName(branch);
      validateBranchName(baseBranch);

      // Ensure we're on the base branch first
      safeGitCheckout(baseBranch, workingDir);
      // Create and checkout new branch
      safeGitCreateBranch(branch, workingDir);

      console.log(`[PM] Created branch ${branch} from ${baseBranch}`);
      return branch;
    } catch (err) {
      console.error(`[PM] Failed to create branch:`, err);
      return null;
    }
  }

  /**
   * Phase 0: Branching — spawn a one-shot Claude call to generate a branch name slug,
   * create the git branch, then auto-advance to 'understanding' phase.
   *
   * This is a non-conversational, system-level step. No conversation history is
   * saved for Phase 0. The Claude session ID is NOT captured (disposable).
   */
  private async runBranchingPhase(
    taskId: string,
    task: Session,
    workingDir: string,
    defaultBranch?: string,
  ): Promise<string> {
    const runId = `run-${taskId}-${Date.now()}`;

    // Temporary session — not persisted to conversation file
    const tempSession: ChatSession = {
      sessionId: taskId,
      conversationId: '',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const run: ProcessRun = {
      runId,
      taskId,
      conversationId: '',  // Phase 0 不使用持久化对话
      process: null,
      status: 'running',
      events: [],
      listeners: new Set(),
      startedAt: Date.now(),
      assistantText: '',
      contentBlocks: [],
      toolCalls: [],
      session: tempSession,
    };

    this.runs.set(taskId, run);

    // Build minimal Phase 0 prompt
    const prompt = buildBranchingPrompt(task.title, task.content);

    // Validate working directory first
    try {
      validateWorkingDir(workingDir);
    } catch (err) {
      throw new Error(`Invalid working directory: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Spawn Claude with no tool permissions
    const permissionArgs = await buildClaudePermissionArgs('branching');
    const branchEnv = await buildClaudeEnv();
    const branchModelArgs = await buildClaudeModelArgs();
    const claude = spawn('claude', [
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
      ...branchModelArgs,
      ...permissionArgs,
    ], {
      cwd: workingDir,
      shell: false,  // 🔒 Security: disable shell to prevent command injection
      env: branchEnv,
    });
    run.process = claude;

    claude.stdin.write(prompt);
    claude.stdin.end();

    // Auto-status: todo → doing
    if (task.status === 'todo') {
      await modifyJsonFile<{ tasks: Session[] }>(getTasksPath(), { tasks: [] }, (data) => {
        const t = data.tasks.find((t) => t.id === taskId);
        if (t && t.status === 'todo') {
          t.status = 'doing';
          t.updatedAt = new Date().toISOString();
        }
        return data;
      });
    }

    // Sync flow task status
    this.syncFlowTaskStatus(task.flowContext, 'doing');

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

    // Handle process exit
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

      if (code !== 0 && !run.assistantText) {
        this.trackAndEmit(run, { type: 'error', message: `Claude exited with code ${code}` });
      }

      // Extract branch slug from AI output
      const branchSlug = extractBranchSlugFromText(run.assistantText);

      // Determine branch name (AI slug or fallback)
      const effectiveSlug = branchSlug || undefined;
      const branch = this.createTaskBranch(taskId, task.title, workingDir, defaultBranch, effectiveSlug);

      // Advance to 'understanding' phase
      await modifyJsonFile<{ tasks: Session[] }>(getTasksPath(), { tasks: [] }, (data) => {
        const t = data.tasks.find((t) => t.id === taskId);
        if (t) {
          if (branch) t.gitBranch = branch;
          t.phase = 'understanding';
          t.updatedAt = new Date().toISOString();
        }
        return data;
      });

      // Emit events to frontend
      if (branch) {
        this.trackAndEmit(run, { type: 'branch_created', branch, slug: branchSlug || '' });
      }
      this.trackAndEmit(run, { type: 'phase_changed', phase: 'understanding' });

      if (!branchSlug) {
        console.warn(`[PM] Phase 0: slug extraction failed, used fallback for ${taskId}`);
      }
      if (!branch) {
        this.trackAndEmit(run, { type: 'error', message: 'Git 分支创建失败，已跳过进入理解阶段。' });
      }

      // Emit done and update status
      this.trackAndEmit(run, { type: 'done' });
      if (run.status === 'running') {
        run.status = code === 0 ? 'completed' : 'failed';
      }
      run.completedAt = Date.now();
    });

    claude.on('error', (err) => {
      this.trackAndEmit(run, { type: 'error', message: `Failed to spawn claude: ${err.message}` });
      this.trackAndEmit(run, { type: 'done' });
      run.status = 'failed';
      run.completedAt = Date.now();
      run.process = null;
    });

    return runId;
  }

  private detectDefaultBranch(workingDir: string): string {
    try {
      return safeDetectDefaultBranch(workingDir);
    } catch (err) {
      console.error('[PM] Failed to detect default branch:', err);
      // Fallback to 'main' if detection fails
      return 'main';
    }
  }

  /**
   * Post-turn update: advance phase + save Claude session ID in a single write.
   */
  private async postTurnUpdate(
    taskId: string,
    currentPhase: SessionPhase | undefined,
    info: {
      hasUnderstanding: boolean;
      hasPlan: boolean;
      hasResult: boolean;
      activeConversationId?: string;
    },
  ): Promise<void> {
    const phase = currentPhase ?? 'understanding';
    let newPhase: SessionPhase | undefined;

    if (info.hasUnderstanding && phase === 'understanding') {
      newPhase = 'planning';
    } else if (info.hasPlan && (phase === 'understanding' || phase === 'planning')) {
      newPhase = 'executing';
    } else if (info.hasResult && phase !== 'summarizing') {
      newPhase = 'summarizing';
    }

    // Skip write if nothing to update
    if (!newPhase && !info.activeConversationId) return;

    const run = this.runs.get(taskId);
    try {
      await modifyJsonFile<{ tasks: Session[] }>(getTasksPath(), { tasks: [] }, (data) => {
        const idx = data.tasks.findIndex((t) => t.id === taskId);
        if (idx !== -1) {
          data.tasks[idx] = {
            ...data.tasks[idx],
            ...(newPhase && { phase: newPhase }),
            ...(info.activeConversationId && { activeConversationId: info.activeConversationId }),
            updatedAt: new Date().toISOString(),
          };
        }
        return data;
      });

      if (newPhase && run) {
        this.trackAndEmit(run, { type: 'phase_changed', phase: newPhase });
      }
    } catch (err) {
      console.error('Failed to update task after turn:', err);
    }
  }

  /**
   * Sync flow task status back to the project flow data file.
   * Called when Session starts (→ doing) and when result is extracted (→ done).
   */
  private async syncFlowTaskStatus(
    flowContext: FlowTaskContext | undefined,
    newStatus: FlowStatus,
  ): Promise<void> {
    if (!flowContext) return;

    try {
      await modifyJsonFile<FlowData>(
        getFlowDataPath(flowContext.projectKey),
        { sections: [] },
        (rawData) => {
          const data: FlowData = isLegacyFormat(rawData)
            ? migrateLegacyToSections(rawData)
            : rawData as FlowData;

          for (const section of data.sections) {
            if (this.updateItemInList(section.items, flowContext.flowTaskId, newStatus)) {
              return data;
            }
          }
          return data;
        },
      );
    } catch (err) {
      console.error(`Failed to sync flow task status to ${newStatus}:`, err);
    }
  }

  /** Recursively find an item by id and update its status. Returns true if found. */
  private updateItemInList(
    items: TreeItem[],
    taskId: string,
    newStatus: FlowStatus,
  ): boolean {
    for (const item of items) {
      if (item.id === taskId) {
        item.status = newStatus;
        return true;
      }
      if (item.children?.length && this.updateItemInList(item.children, taskId, newStatus)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Track an event in the accumulation state and emit to listeners.
   */
  private trackAndEmit(run: ProcessRun, event: ChatSSEEvent): void {
    // Diagnostic: log first text_delta and all non-text events
    if (event.type === 'text_delta') {
      if (run.events.length === 0 || !run.events.some(e => e.type === 'text_delta')) {
        console.log(`[PM] first text_delta for ${run.taskId}, listeners: ${run.listeners.size}`);
      }
    } else {
      console.log(`[PM] event: ${event.type}, task: ${run.taskId}, listeners: ${run.listeners.size}`);
    }

    // Track (mirrors the old trackBlock logic)
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

      // Dangerous command detection for Bash tools
      if (event.toolName === 'Bash') {
        const danger = detectDangerousCommand(event.input);
        if (danger) {
          // Emit warning to frontend immediately (before the tool finishes)
          const warningEvent: ChatSSEEvent = {
            type: 'dangerous_tool_warning',
            toolCallId: event.id,
            toolName: event.toolName,
            command: event.input,
            reason: danger.reason,
            level: danger.level,
          };
          // Use direct emit to avoid infinite recursion
          const wIdx = run.events.length;
          run.events.push(warningEvent);
          for (const listener of run.listeners) {
            try { listener(warningEvent, wIdx); } catch { /* */ }
          }

          // Critical level: auto-stop the process to prevent damage
          if (danger.level === 'critical' && run.process) {
            console.warn(`[PM] CRITICAL danger detected, auto-stopping: ${danger.reason}`);
            run.status = 'stopped';
            run.process.kill('SIGTERM');
          }
        }
      }
    } else if (event.type === 'tool_use_end') {
      const tc = run.toolCalls.find((t) => t.id === event.id);
      if (tc) {
        tc.output = event.output;
        tc.status = event.status;
      }
    }

    // Emit to listeners
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

  /**
   * Check if the AI produced the expected artifact for the current phase.
   * If not, emit retry_needed (up to 2 retries = 3 total attempts).
   * If retries exhausted, emit error for user intervention.
   */
  private checkAndEmitRetry(
    run: ProcessRun,
    taskId: string,
    phase: SessionPhase | undefined,
    produced: { hasUnderstanding: boolean; hasPlan: boolean; hasResult: boolean },
  ): void {
    const effective = phase ?? 'understanding';

    // Only phases that expect a specific artifact per turn
    let wasProduced = false;
    switch (effective) {
      case 'branching':
        return; // Phase 0 handles its own retry/fallback logic
      case 'understanding':
        wasProduced = produced.hasUnderstanding;
        break;
      case 'planning':
        wasProduced = produced.hasPlan;
        break;
      case 'summarizing':
        wasProduced = produced.hasResult;
        break;
      default:
        return; // executing: no per-turn artifact expected
    }

    const retryKey = `${taskId}:${effective}`;

    if (wasProduced) {
      this.retryCounts.delete(retryKey);
      return;
    }

    // Artifact not produced — check retry budget
    const count = this.retryCounts.get(retryKey) ?? 0;
    if (count < 2) {
      this.retryCounts.set(retryKey, count + 1);
      this.trackAndEmit(run, {
        type: 'retry_needed',
        attempt: count + 2, // attempt 1 was the original, this is 2 or 3
        maxAttempts: 3,
        retryMessage: buildRetryMessage(effective, count + 2),
      });
    } else {
      this.retryCounts.delete(retryKey);
      this.trackAndEmit(run, {
        type: 'error',
        message: '格式提取失败（已尝试 3 次），请手动指导 AI 用正确格式输出。',
      });
    }
  }

  /**
   * Detect interrupted sessions: tasks with phase=executing/planning
   * but no active process run. Returns list for recovery UI.
   */
  async detectInterruptedSessions(): Promise<Array<{
    taskId: string;
    phase: SessionPhase;
    conversationId: string;
    claudeSessionId?: string;
  }>> {
    const tasksData = await readJsonFile<{ tasks: Session[] }>(getTasksPath(), { tasks: [] });
    const interrupted: Array<{
      taskId: string;
      phase: SessionPhase;
      conversationId: string;
      claudeSessionId?: string;
    }> = [];

    for (const task of tasksData.tasks) {
      // Skip if there's an active run
      const run = this.runs.get(task.id);
      if (run && run.status === 'running') continue;

      // Only detect tasks in execution-like phases
      const phase = task.phase;
      if (phase !== 'executing' && phase !== 'planning' && phase !== 'summarizing') continue;

      // Find active conversation with claudeSessionId
      try {
        const convIndex = await ensureConversationIndex(task.id);
        const activeConvId = task.activeConversationId || convIndex.activeConversationId;
        if (!activeConvId) continue;

        const session = await readJsonFile<ChatSession>(
          getConversationFilePath(task.id, activeConvId),
          DEFAULT_SESSION(task.id, activeConvId),
        );

        // Only add if there's a session ID to resume with
        const csId = session.claudeSessionId ?? task.claudeSessionId;
        if (csId) {
          interrupted.push({
            taskId: task.id,
            phase: phase as SessionPhase,
            conversationId: activeConvId,
            claudeSessionId: csId,
          });
        }
      } catch {
        // Skip tasks with corrupted conversation data
      }
    }

    return interrupted;
  }

  /**
   * Remove completed runs older than TTL.
   */
  private sweep(): void {
    const now = Date.now();
    for (const [taskId, run] of this.runs) {
      if (
        run.status !== 'running' &&
        run.completedAt &&
        now - run.completedAt > COMPLETED_TTL_MS
      ) {
        this.runs.delete(taskId);
      }
    }
  }
}

/**
 * Generate a unique, descriptive branch name from taskId + title.
 * Format: task/{shortId}-{slug}
 *
 * Slug priority:
 * 1. branchSlug from AI (English kebab-case, e.g. "fix-login-button")
 * 2. Pinyin from Chinese title (first 6 chars, e.g. "xiufud")
 * 3. shortId only (fallback)
 */
function generateBranchName(taskId: string, title: string, branchSlug?: string): string {
  const shortId = taskId.replace(/^task-/, '').slice(-8);

  // Priority 1: AI-generated English slug
  if (branchSlug) {
    const cleaned = branchSlug
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    if (cleaned) return `task/${shortId}-${cleaned}`;
  }

  // Priority 2: pinyin fallback for Chinese titles
  try {
    const { pinyin } = require('pinyin-pro');
    const py: string = pinyin(title, { toneType: 'none', type: 'array' })
      .join('')
      .replace(/[^a-z]/g, '')
      .slice(0, 6);
    if (py) return `task/${shortId}-${py}`;
  } catch { /* pinyin-pro not available, skip */ }

  // Priority 3: shortId only
  return `task/${shortId}`;
}

/**
 * Build a brief note about the current phase to prefix resume messages.
 * This tells Claude what phase it's in and what tools are available,
 * since the original prompt's phase reminder is now stale.
 */
function buildPhaseTransitionNote(phase: SessionPhase | undefined): string | null {
  switch (phase ?? 'understanding') {
    case 'branching':
      return '[系统提示：当前阶段 Phase 0（分支创建）。系统正在自动生成分支名称。]';
    case 'understanding':
      return '[系统提示：当前阶段 Phase 1-2（理解任务）。你没有工具权限。请继续确认四要素。]';
    case 'planning':
      return '[系统提示：阶段已推进到 Phase 3（规划）。你现在有完整的工具权限，可以阅读代码和文件来制定计划。]';
    case 'executing':
      return '[系统提示：当前阶段 Phase 4（执行）。你有完整的工具权限。Git 分支已由系统创建，无需你创建。按计划执行。]';
    case 'summarizing':
      return '[系统提示：当前阶段 Phase 5（总结）。总结执行结果。]';
    default:
      return null;
  }
}

/**
 * Build a retry message for a specific phase when artifact extraction fails.
 */
function buildRetryMessage(phase: SessionPhase, attempt: number): string {
  const prefix = `[系统自动重试 ${attempt}/3]`;

  switch (phase) {
    case 'branching':
      return `${prefix} 分支名称提取失败。请用以下格式输出：

\`\`\`json:branch
{
  "slug": "descriptive-branch-name"
}
\`\`\``;

    case 'understanding':
      return `${prefix} 你的回复中没有检测到格式化的任务理解。请在回复末尾用以下格式输出：

\`\`\`json:understanding
{
  "project": "项目名",
  "action": "具体要做的事",
  "goal": "上层目标/为什么做",
  "deliverable": "交付物描述",
  "branchSlug": "fix-login-button"
}
\`\`\`
branchSlug：简短英文 kebab-case，描述任务内容。`;

    case 'planning':
      return `${prefix} 你的回复中没有检测到格式化的执行计划。请在回复末尾用以下格式输出：

\`\`\`json:plan
{
  "analysis": "任务分析",
  "steps": [{"id": 1, "type": "auto", "action": "步骤名", "description": "说明", "status": "pending"}],
  "expected_results": "预期结果",
  "risks": "风险评估"
}
\`\`\``;

    case 'summarizing':
      return `${prefix} 你的回复中没有检测到格式化的执行结果。请在回复末尾用以下格式输出：

\`\`\`json:result
{
  "status": "completed",
  "summary": "完成情况概述",
  "files_changed": [{"path": "文件路径", "action": "created|modified|deleted"}]
}
\`\`\``;

    default:
      return '';
  }
}

// ── Singleton (survives Next.js HMR in dev mode) ──

const globalForPM = globalThis as unknown as {
  __processManager?: ProcessManager;
};

export const processManager =
  globalForPM.__processManager ?? new ProcessManager();

if (process.env.NODE_ENV !== 'production') {
  globalForPM.__processManager = processManager;
}
