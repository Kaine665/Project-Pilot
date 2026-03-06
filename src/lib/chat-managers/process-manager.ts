/**
 * ProcessManager — Claude subprocess lifecycle manager for structured tasks.
 *
 * Extends BaseChatManager with:
 * - Five-phase workflow (branching → understanding → planning → executing → summarizing)
 * - Git worktree isolation per task
 * - Artifact extraction (understanding, plan, result)
 * - Auto-merge on completion
 * - Retry mechanism for missing artifacts
 * - Flow task status sync
 * - Interrupted session detection
 */

import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { BaseChatManager } from './base-chat-manager';
import type { BaseRun, SpawnConfig } from './types';
import type { StreamParser } from '@/lib/claude-stream-parser';
import { StreamParser as StreamParserClass, LineBuffer } from '@/lib/claude-stream-parser';
import {
  getConversationPath,
  getConversationFilePath,
  getConversationIndexPath,
  getTasksPath,
  getProjectsPath,
  getAgentsPath,
  getFlowDataPath,
  getTaskArtifactsPath,
  readJsonFile,
  writeJsonFile,
  modifyJsonFile,
} from '@/lib/file-store';
import {
  validateWorkingDir,
  validateBranchName,
  validateWorktreePath,
  safeGitCheckout,
  safeGitCreateBranch,
  safeGitMerge,
  safeGitDeleteBranch,
  safeGitCurrentBranch,
  safeGitWorktreeAdd,
  safeGitWorktreeRemove,
  safeGitExec,
  detectDefaultBranch as safeDetectDefaultBranch,
} from '@/lib/security';
import { ensureConversationIndex, updateConversationMeta } from '@/lib/conversation-migration';
import { buildPrompt, buildBranchingPrompt, type PromptContext } from '@/lib/prompt-builder';
import {
  buildClaudeEnv,
  buildClaudeModelArgs,
  buildClaudeMaxTurnsArgs,
  buildClaudePermissionArgs,
  buildAgentToolArgs,
  buildAgentPermissionArgs,
} from '@/lib/settings-manager';
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
  AgentsData,
  ChatSession,
  ChatMessage,
  ChatSSEEvent,
  ProjectsData,
  TaskArtifacts,
} from '@/types';
import type { FlowData, TreeItem, Status as FlowStatus } from '@/types/flow';
import { isLegacyFormat, migrateLegacyToSections } from '@/lib/flow-migration';
import { TASK_WORKER_AGENT_ID, DEFAULT_AGENTS } from '@/lib/default-agents';
import type { FlowTaskContext } from '@/types/flow-context';

// ── Types ──

export interface ProcessRun extends BaseRun {
  taskId: string;
  conversationId: string;
  session: ChatSession;
}

interface ProcessDomainData {
  taskId: string;
  conversationId: string;
  session: ChatSession;
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

class ProcessManager extends BaseChatManager<ProcessRun> {
  protected readonly completedTtlMs = 5 * 60 * 1000; // 5 minutes
  protected readonly logPrefix = '[PM]';

  private retryCounts = new Map<string, number>();

  // ═══════════════════════════════════════════════════════════════════════
  // Public: start a task conversation
  // ═══════════════════════════════════════════════════════════════════════

  async start(taskId: string, message: string, conversationId?: string): Promise<string> {
    const existing = this.runs.get(taskId);
    if (existing?.status === 'running') {
      throw new Error('A process is already running for this task');
    }

    // ── Load data ──
    const tasksData = await readJsonFile<{ tasks: Session[] }>(getTasksPath(), { tasks: [] });
    const task = tasksData.tasks.find((t) => t.id === taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    const projectsData = await readJsonFile<ProjectsData>(getProjectsPath(), { projects: {} });
    const project = task.projectKey ? projectsData.projects[task.projectKey] ?? null : null;
    const projectDir = project?.path ?? process.cwd();

    // ── Load agent capabilities ──
    const agentCaps = await (async () => {
      const effectiveAgentId = task.agentId || TASK_WORKER_AGENT_ID;
      const agentsData = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });
      const diskAgent = agentsData.agents.find(a => a.id === effectiveAgentId);
      const builtinAgent = DEFAULT_AGENTS.find(a => a.id === effectiveAgentId);
      const agent = diskAgent ?? builtinAgent;
      return agent?.capabilities;
    })();

    // ── Phase 0: branching ──
    if (task.phase === 'branching') {
      return this.runBranchingPhase(taskId, task, projectDir, project?.defaultBranch);
    }

    // ── Ensure worktree exists ──
    if (task.gitBranch && project?.path) {
      const wtPath = this.ensureWorktree(task, project.path);
      if (wtPath && wtPath !== task.worktreePath) {
        await modifyJsonFile<{ tasks: Session[] }>(getTasksPath(), { tasks: [] }, (data) => {
          const t = data.tasks.find((t) => t.id === taskId);
          if (t) {
            t.worktreePath = wtPath;
            t.updatedAt = new Date().toISOString();
          }
          return data;
        });
        task.worktreePath = wtPath;
      }
    }

    const workingDir = task.worktreePath ?? projectDir;

    // ── Resolve conversation ──
    const convIndex = await ensureConversationIndex(taskId);
    let effectiveConvId = conversationId;

    if (!effectiveConvId) {
      if (convIndex.activeConversationId) {
        effectiveConvId = convIndex.activeConversationId;
      } else {
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
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };
    session.messages.push(userMsg);

    // ── First turn vs resume ──
    const claudeSessionId = session.claudeSessionId ?? task.claudeSessionId;
    const isResume = !!claudeSessionId;
    let stdinContent: string;

    if (isResume) {
      const phaseNote = buildPhaseTransitionNote(task.phase);
      stdinContent = phaseNote ? `${phaseNote}\n\n${message}` : message;
    } else {
      const promptCtx: PromptContext = {
        task,
        project,
        history: session.messages.slice(0, -1),
        newMessage: message,
        detectedBaseBranch: (() => { try { return this.detectDefaultBranch(workingDir); } catch { return undefined; } })(),
      };
      stdinContent = await buildPrompt(promptCtx);
    }

    // Save user message immediately
    session.updatedAt = new Date().toISOString();
    await writeJsonFile(getConversationFilePath(taskId, effectiveConvId), session);

    // ── Validate working directory ──
    try {
      validateWorkingDir(workingDir);
    } catch (err) {
      throw new Error(`Invalid working directory: ${err instanceof Error ? err.message : String(err)}`);
    }

    // ── Build CLI args ──
    const permissionArgs = await buildAgentPermissionArgs(task.phase, agentCaps);
    const toolArgs = buildAgentToolArgs(agentCaps);
    const resumeArgs = isResume ? ['--resume', claudeSessionId!] : [];
    const claudeEnv = await buildClaudeEnv();
    const modelArgs = await buildClaudeModelArgs();
    const maxTurnsArgs = await buildClaudeMaxTurnsArgs();

    const config: SpawnConfig<ProcessDomainData> = {
      runKey: taskId,
      workingDir,
      stdinContent,
      isResume,
      claudeSessionId,
      extraCliArgs: [
        ...modelArgs,
        ...maxTurnsArgs,
        ...permissionArgs,
        ...toolArgs,
        ...resumeArgs,
      ],
      env: claudeEnv,
      domainData: {
        taskId,
        conversationId: effectiveConvId,
        session,
      },
    };

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

    const run = await this.spawnAndManage(config);
    return run.runId;
  }

  /**
   * Get the conversationId of the current/last run for a task.
   */
  getRunConversationId(taskId: string): string | undefined {
    return this.runs.get(taskId)?.conversationId || undefined;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Protected: BaseChatManager abstract implementations
  // ═══════════════════════════════════════════════════════════════════════

  protected createRun(config: SpawnConfig<ProcessDomainData>, shell: BaseRun): ProcessRun {
    const d = config.domainData;
    return {
      ...shell,
      taskId: d.taskId,
      conversationId: d.conversationId,
      session: d.session,
    };
  }

  protected async persistAfterClose(run: ProcessRun, aborted: boolean): Promise<void> {
    if (run.assistantText || run.contentBlocks.length > 0) {
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        content: run.assistantText,
        timestamp: new Date().toISOString(),
        toolCalls: run.toolCalls.length > 0 ? [...run.toolCalls] : undefined,
        contentBlocks: run.contentBlocks.length > 0 ? [...run.contentBlocks] : undefined,
        interrupted: aborted || undefined,
      };

      // Attach extracted plan ID if available
      if ((run as ProcessRun & { _extractedPlanId?: string })._extractedPlanId) {
        assistantMsg.extractedPlanId = (run as ProcessRun & { _extractedPlanId?: string })._extractedPlanId;
      }

      run.session.messages.push(assistantMsg);
      run.session.updatedAt = new Date().toISOString();
      await writeJsonFile(getConversationFilePath(run.taskId, run.conversationId), run.session);

      // Update conversation index metadata
      await updateConversationMeta(run.taskId, run.conversationId, {
        messageCount: run.session.messages.length,
        updatedAt: run.session.updatedAt,
        claudeSessionId: run.session.claudeSessionId,
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
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Protected: hook overrides
  // ═══════════════════════════════════════════════════════════════════════

  protected async onProcessClose(
    run: ProcessRun,
    aborted: boolean,
    streamParser: StreamParser,
  ): Promise<void> {
    if (aborted) return;

    // Save Claude session ID to conversation level
    const newClaudeSessionId = streamParser.sessionId ?? undefined;
    if (newClaudeSessionId) {
      run.session.claudeSessionId = newClaudeSessionId;
    }

    // ── Extract artifacts ──
    const planData = extractPlanFromText(run.assistantText);
    if (planData) {
      try {
        const planId = await savePlan(run.taskId, planData);
        // Store for persistAfterClose to attach to message
        (run as ProcessRun & { _extractedPlanId?: string })._extractedPlanId = planId;
        this.trackAndEmit(run, { type: 'plan_extracted', planId });
      } catch (err) {
        console.error('Failed to extract plan:', err);
      }
    }

    const understanding = extractUnderstandingFromText(run.assistantText);
    if (understanding) {
      try {
        await saveUnderstanding(run.taskId, understanding);
        this.trackAndEmit(run, { type: 'understanding_extracted', understanding });
      } catch (err) {
        console.error('Failed to extract understanding:', err);
      }
    }

    const result = extractResultFromText(run.assistantText);
    if (result) {
      try {
        await saveResult(run.taskId, result);
        this.trackAndEmit(run, { type: 'result_extracted', result });
      } catch (err) {
        console.error('Failed to extract result:', err);
      }

      // Auto-merge on completion
      if (result.status === 'completed') {
        // Need project dir (main repo, not worktree)
        const tasksData = await readJsonFile<{ tasks: Session[] }>(getTasksPath(), { tasks: [] });
        const task = tasksData.tasks.find((t) => t.id === run.taskId);
        if (task?.projectKey) {
          const projectsData = await readJsonFile<ProjectsData>(getProjectsPath(), { projects: {} });
          const project = projectsData.projects[task.projectKey];
          if (project?.path) {
            await this.autoMergeBranch(run.taskId, project.path, project.defaultBranch, run);
          }
        }
      }
    }

    // ── Auto-advance phase ──
    const tasksData = await readJsonFile<{ tasks: Session[] }>(getTasksPath(), { tasks: [] });
    const task = tasksData.tasks.find((t) => t.id === run.taskId);

    await this.postTurnUpdate(run.taskId, task?.phase, {
      hasUnderstanding: !!understanding,
      hasPlan: !!planData,
      hasResult: !!result,
      activeConversationId: run.conversationId,
    });

    // ── Check retry ──
    this.checkAndEmitRetry(run, run.taskId, task?.phase, {
      hasUnderstanding: !!understanding,
      hasPlan: !!planData,
      hasResult: !!result,
    });
  }

  protected async onStop(taskId: string, _run: ProcessRun): Promise<void> {
    // Best-effort worktree cleanup
    try {
      const tasksData = await readJsonFile<{ tasks: Session[] }>(getTasksPath(), { tasks: [] });
      const task = tasksData.tasks.find((t) => t.id === taskId);
      if (task?.worktreePath && task?.projectKey) {
        const projectsData = await readJsonFile<ProjectsData>(getProjectsPath(), { projects: {} });
        const project = projectsData.projects[task.projectKey];
        if (project?.path) {
          try {
            safeGitWorktreeRemove(task.worktreePath, project.path, true);
            console.log(`[PM] Cleaned up worktree at ${task.worktreePath} on stop`);
          } catch { /* best-effort */ }
        }
        await modifyJsonFile<{ tasks: Session[] }>(getTasksPath(), { tasks: [] }, (data) => {
          const t = data.tasks.find((t) => t.id === taskId);
          if (t) {
            t.worktreePath = undefined;
            t.updatedAt = new Date().toISOString();
          }
          return data;
        });
      }
    } catch (err) {
      console.error('[PM] Failed to cleanup worktree on stop:', err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 0: Branching (special one-shot flow, not using base spawnAndManage)
  // ═══════════════════════════════════════════════════════════════════════

  private async runBranchingPhase(
    taskId: string,
    task: Session,
    workingDir: string,
    defaultBranch?: string,
  ): Promise<string> {
    const runId = `run-${taskId}-${Date.now()}`;

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
      conversationId: '',
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

    const prompt = buildBranchingPrompt(task.title, task.content);

    try {
      validateWorkingDir(workingDir);
    } catch (err) {
      throw new Error(`Invalid working directory: ${err instanceof Error ? err.message : String(err)}`);
    }

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
      shell: false,
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

    this.syncFlowTaskStatus(task.flowContext, 'doing');

    // Wire up stdout parsing
    const lineBuffer = new LineBuffer();
    const streamParser = new StreamParserClass();

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

      if (code !== 0 && !run.assistantText) {
        this.trackAndEmit(run, { type: 'error', message: `Claude exited with code ${code}` });
      }

      const branchSlug = extractBranchSlugFromText(run.assistantText);
      const effectiveSlug = branchSlug || undefined;
      const wtResult = this.createTaskWorktree(taskId, task.title, workingDir, defaultBranch, effectiveSlug);

      await modifyJsonFile<{ tasks: Session[] }>(getTasksPath(), { tasks: [] }, (data) => {
        const t = data.tasks.find((t) => t.id === taskId);
        if (t) {
          if (wtResult) {
            t.gitBranch = wtResult.branch;
            t.worktreePath = wtResult.worktreePath;
          }
          t.phase = 'understanding';
          t.updatedAt = new Date().toISOString();
        }
        return data;
      });

      if (wtResult) {
        this.trackAndEmit(run, { type: 'branch_created', branch: wtResult.branch, slug: branchSlug || '' });
      }
      this.trackAndEmit(run, { type: 'phase_changed', phase: 'understanding' });

      if (!branchSlug) {
        console.warn(`[PM] Phase 0: slug extraction failed, used fallback for ${taskId}`);
      }
      if (!wtResult) {
        this.trackAndEmit(run, { type: 'error', message: 'Git worktree 创建失败，已跳过进入理解阶段。' });
      }

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

  // ═══════════════════════════════════════════════════════════════════════
  // Git worktree management
  // ═══════════════════════════════════════════════════════════════════════

  private async autoMergeBranch(
    taskId: string,
    projectDir: string,
    defaultBranch: string | undefined,
    run: ProcessRun,
  ): Promise<void> {
    try {
      validateWorkingDir(projectDir);

      const tasksData = await readJsonFile<{ tasks: Session[] }>(getTasksPath(), { tasks: [] });
      const task = tasksData.tasks.find((t) => t.id === taskId);
      if (!task?.gitBranch) return;

      const gitBranch = task.gitBranch;
      const worktreePath = task.worktreePath;
      const targetBranch = defaultBranch ?? this.detectDefaultBranch(projectDir);

      validateBranchName(gitBranch);
      validateBranchName(targetBranch);

      if (worktreePath) {
        try {
          safeGitWorktreeRemove(worktreePath, projectDir, true);
          console.log(`[PM] Removed worktree at ${worktreePath}`);
        } catch (err) {
          console.warn(`[PM] Failed to remove worktree (continuing):`, err);
        }
      }

      safeGitCheckout(targetBranch, projectDir);
      safeGitMerge(gitBranch, projectDir, `Merge task branch ${gitBranch}`);

      try {
        safeGitDeleteBranch(gitBranch, projectDir);
      } catch { /* Ignore deletion failures */ }

      console.log(`[PM] Auto-merged ${gitBranch} → ${targetBranch}`);
      this.trackAndEmit(run, {
        type: 'branch_merged',
        branch: gitBranch,
        targetBranch,
      });

      await modifyJsonFile<{ tasks: Session[] }>(getTasksPath(), { tasks: [] }, (data) => {
        const t = data.tasks.find((t) => t.id === taskId);
        if (t) {
          t.gitBranch = undefined;
          t.worktreePath = undefined;
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

  private createTaskWorktree(
    taskId: string,
    title: string,
    projectDir: string,
    defaultBranch?: string,
    branchSlug?: string,
  ): { branch: string; worktreePath: string } | null {
    try {
      validateWorkingDir(projectDir);

      const branch = generateBranchName(taskId, title, branchSlug);
      const baseBranch = defaultBranch ?? this.detectDefaultBranch(projectDir);

      validateBranchName(branch);
      validateBranchName(baseBranch);

      const shortId = taskId.replace(/^task-/, '').slice(-8);
      const safeName = branch.replace(/^task\//, '').replace(/[^a-zA-Z0-9_-]/g, '-');
      const worktreePath = path.join(projectDir, '.worktrees', `${shortId}-${safeName}`);

      validateWorktreePath(worktreePath, projectDir);

      safeGitWorktreeAdd(worktreePath, branch, baseBranch, projectDir);
      this.ensureWorktreesGitignored(projectDir);

      console.log(`[PM] Created worktree at ${worktreePath} on branch ${branch} from ${baseBranch}`);
      return { branch, worktreePath };
    } catch (err) {
      console.error(`[PM] Failed to create worktree:`, err);
      return null;
    }
  }

  private ensureWorktreesGitignored(projectDir: string): void {
    try {
      const gitignorePath = path.join(projectDir, '.gitignore');
      let content = '';
      try {
        content = fs.readFileSync(gitignorePath, 'utf-8');
      } catch { /* file doesn't exist */ }
      if (!content.includes('.worktrees')) {
        const line = content.endsWith('\n') || content === '' ? '.worktrees/\n' : '\n.worktrees/\n';
        fs.appendFileSync(gitignorePath, line, 'utf-8');
      }
    } catch { /* best-effort */ }
  }

  private ensureWorktree(task: Session, projectDir: string): string | null {
    if (task.worktreePath) {
      try {
        fs.statSync(task.worktreePath);
        return task.worktreePath;
      } catch { /* Worktree directory missing, recreate below */ }
    }

    if (!task.gitBranch) return null;

    try {
      validateWorkingDir(projectDir);
      validateBranchName(task.gitBranch);

      const shortId = task.id.replace(/^task-/, '').slice(-8);
      const safeName = task.gitBranch.replace(/^task\//, '').replace(/[^a-zA-Z0-9_-]/g, '-');
      const worktreePath = path.join(projectDir, '.worktrees', `${shortId}-${safeName}`);
      validateWorktreePath(worktreePath, projectDir);

      safeGitExec(
        ['worktree', 'add', worktreePath, task.gitBranch],
        { cwd: projectDir },
      );

      console.log(`[PM] Recreated worktree at ${worktreePath} for branch ${task.gitBranch}`);
      return worktreePath;
    } catch (err) {
      console.error('[PM] Failed to recreate worktree:', err);
      return null;
    }
  }

  private detectDefaultBranch(workingDir: string): string {
    try {
      return safeDetectDefaultBranch(workingDir);
    } catch (err) {
      console.error('[PM] Failed to detect default branch:', err);
      return 'main';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Phase management
  // ═══════════════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════════════
  // Retry mechanism
  // ═══════════════════════════════════════════════════════════════════════

  private checkAndEmitRetry(
    run: ProcessRun,
    taskId: string,
    phase: SessionPhase | undefined,
    produced: { hasUnderstanding: boolean; hasPlan: boolean; hasResult: boolean },
  ): void {
    const effective = phase ?? 'understanding';

    let wasProduced = false;
    switch (effective) {
      case 'branching':
        return;
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
        return;
    }

    const retryKey = `${taskId}:${effective}`;

    if (wasProduced) {
      this.retryCounts.delete(retryKey);
      return;
    }

    const count = this.retryCounts.get(retryKey) ?? 0;
    if (count < 2) {
      this.retryCounts.set(retryKey, count + 1);
      this.trackAndEmit(run, {
        type: 'retry_needed',
        attempt: count + 2,
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

  // ═══════════════════════════════════════════════════════════════════════
  // Interrupted session detection
  // ═══════════════════════════════════════════════════════════════════════

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
      const run = this.runs.get(task.id);
      if (run && run.status === 'running') continue;

      const phase = task.phase;
      if (phase !== 'executing' && phase !== 'planning' && phase !== 'summarizing') continue;

      try {
        const convIndex = await ensureConversationIndex(task.id);
        const activeConvId = task.activeConversationId || convIndex.activeConversationId;
        if (!activeConvId) continue;

        const session = await readJsonFile<ChatSession>(
          getConversationFilePath(task.id, activeConvId),
          DEFAULT_SESSION(task.id, activeConvId),
        );

        const csId = session.claudeSessionId ?? task.claudeSessionId;
        if (csId) {
          interrupted.push({
            taskId: task.id,
            phase: phase as SessionPhase,
            conversationId: activeConvId,
            claudeSessionId: csId,
          });
        }
      } catch { /* Skip tasks with corrupted conversation data */ }
    }

    return interrupted;
  }
}

// ── Helper functions (module-level) ──

function generateBranchName(taskId: string, title: string, branchSlug?: string): string {
  const shortId = taskId.replace(/^task-/, '').slice(-8);

  if (branchSlug) {
    const cleaned = branchSlug
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    if (cleaned) return `task/${shortId}-${cleaned}`;
  }

  try {
    const { pinyin } = require('pinyin-pro');
    const py: string = pinyin(title, { toneType: 'none', type: 'array' })
      .join('')
      .replace(/[^a-z]/g, '')
      .slice(0, 6);
    if (py) return `task/${shortId}-${py}`;
  } catch { /* pinyin-pro not available */ }

  return `task/${shortId}`;
}

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

// ── Singleton ──

const globalForPM = globalThis as unknown as {
  __processManager?: ProcessManager;
};

export const processManager =
  globalForPM.__processManager ?? new ProcessManager();

if (process.env.NODE_ENV !== 'production') {
  globalForPM.__processManager = processManager;
}
