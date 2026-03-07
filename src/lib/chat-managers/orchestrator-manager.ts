/**
 * OrchestratorManager — 多 Agent 并行编排层。
 *
 * 与 BaseChatManager（管理单个 Claude 进程）不同，
 * OrchestratorManager 协调多个并行 worker 进程，
 * 每个 worker 在独立 git worktree 中运行。
 *
 * 编排流程（代码驱动，非 AI 驱动）：
 * 1. split     — AI 拆分任务为并行子任务
 * 2. spawn     — 创建 worktree + 启动 worker 进程
 * 3. execute   — 并行执行，监控 stdout
 * 4. synthesize — AI 汇总所有 worker 结果
 * 5. merge     — 合并分支（需用户确认）
 */

import { type ChildProcess } from 'child_process';
import { spawnClaude } from '@/lib/claude-cli';
import path from 'path';
import { StreamParser, LineBuffer } from '@/lib/claude-stream-parser';
import {
  buildClaudeEnv,
  buildClaudeModelArgs,
  buildClaudeMaxTurnsArgs,
} from '@/lib/settings-manager';
import {
  validateBranchName,
  validateWorktreePath,
  safeGitWorktreeAdd,
  safeGitWorktreeRemove,
  safeGitCheckout,
  safeGitMerge,
  safeGitDeleteBranch,
  detectDefaultBranch,
} from '@/lib/security';
import {
  getOrchestratorSessionsPath,
  readJsonFile,
  modifyJsonFile,
} from '@/lib/file-store';
import type {
  OrchestratorSession,
  OrchestratorPhase,
  OrchestratorSSEEvent,
  OrchestratorSessionsData,
  WorkerTask,
  WorkerResult,
  SplitPlan,
} from '@/types/orchestrator';
import type { ChatSSEEvent } from '@/types';

// ── Constants ──

const DEFAULT_SESSIONS_DATA: OrchestratorSessionsData = { sessions: [] };
const SWEEP_INTERVAL_MS = 60_000;
const COMPLETED_TTL_MS = 30 * 60 * 1000;

// ── Worker Runtime State (in-memory only) ──

interface WorkerRuntime {
  workerId: string;
  process: ChildProcess | null;
  events: ChatSSEEvent[];
  streamParser: StreamParser;
  lineBuffer: LineBuffer;
}

// ── Orchestration Runtime State (in-memory only) ──

interface OrchestrationRuntime {
  session: OrchestratorSession;
  workers: Map<string, WorkerRuntime>;
  events: OrchestratorSSEEvent[];
  listeners: Set<(event: OrchestratorSSEEvent, index: number) => void>;
  completedAt?: number;
  splitProcess?: ChildProcess;
  synthesizeProcess?: ChildProcess;
}

// ── Prompt Builders ──

function buildSplitPrompt(prompt: string): string {
  return `你是一个任务分解专家。用户给你一个复合开发任务，你需要将它拆分成可以并行或串行执行的子任务。

**规则：**
1. 每个子任务应该可以在独立的 git 分支上完成
2. 子任务之间不应修改同一个文件（有依赖关系的除外——后执行的任务可以基于先完成任务的结果继续）
3. 每个子任务应该足够具体，一个 AI agent 可以独立完成
4. 生成 2-5 个子任务
5. 如果某个子任务必须等另一个完成后才能开始（如：先建数据库 Schema，再写 API 层），用 dependsOn 声明依赖关系
6. dependsOn 引用的是其他任务的 branchSlug。没有依赖的任务省略该字段或传空数组
7. 确保依赖关系不形成环（A→B→A 是非法的）

**输出格式（必须是有效的 JSON）：**

\`\`\`json:split-plan
{
  "analysis": "对任务的整体分析，包括任务间的依赖关系",
  "tasks": [
    {
      "title": "子任务标题",
      "description": "详细描述，包括要修改哪些文件、实现什么功能",
      "branchSlug": "kebab-case-branch-name",
      "estimatedComplexity": "low|medium|high",
      "dependsOn": ["another-branch-slug"]
    }
  ],
  "expectedOutcome": "完成后的预期效果"
}
\`\`\`

**依赖关系示例：**
- 任务 A（branchSlug: "db-schema"）无依赖 → dependsOn 省略
- 任务 B（branchSlug: "api-layer"）依赖 A → dependsOn: ["db-schema"]
- 任务 C（branchSlug: "auth-middleware"）无依赖 → dependsOn 省略
- 任务 D（branchSlug: "frontend"）依赖 B 和 C → dependsOn: ["api-layer", "auth-middleware"]
执行顺序：A 和 C 并行 → B 等 A 完成后启动 → D 等 B 和 C 都完成后启动

**用户任务：**
${prompt}

请分析并输出 JSON 格式的拆分计划。`;
}

function buildWorkerPrompt(
  originalTask: string,
  subTaskTitle: string,
  subTaskDescription: string,
): string {
  return `你是一个开发 agent，正在处理一个子任务。

**原始任务背景：**
${originalTask}

**你负责的子任务：**
标题：${subTaskTitle}
描述：${subTaskDescription}

**要求：**
1. 只完成你被分配的子任务，不要越界处理其他部分
2. 所有代码改动都在当前工作目录中进行
3. 完成后用 git commit 提交你的改动
4. 完成后输出结果摘要

**完成后请用以下格式输出结果：**

\`\`\`json:result
{
  "status": "completed",
  "summary": "完成情况的简要描述",
  "filesChanged": [
    {"path": "file/path.ts", "action": "created|modified|deleted"}
  ]
}
\`\`\`

现在开始执行你的子任务。`;
}

function buildSynthesizePrompt(
  originalTask: string,
  workers: WorkerTask[],
): string {
  const summaries = workers.map(w => {
    const status = w.status === 'completed' ? '✅ 已完成' : '❌ 失败';
    const detail = w.result
      ? `摘要: ${w.result.summary}\n文件: ${w.result.filesChanged.map(f => `${f.action} ${f.path}`).join(', ')}`
      : w.errorMessage || '无结果';
    return `### ${w.title}\n状态: ${status}\n${detail}`;
  }).join('\n\n');

  return `你是一个项目协调者。多个 AI agent 并行完成了一个复合任务的各个部分，现在需要你总结整体完成情况。

**原始任务：**
${originalTask}

**各子任务完成情况：**

${summaries}

**请提供：**
1. 整体完成状态评估
2. 各部分是否存在冲突或需要人工调整
3. 下一步建议（如果有）

请用中文输出总结报告。`;
}

// ── Result Extractors ──

function extractSplitPlan(text: string): SplitPlan | null {
  const match = text.match(/```json:split-plan\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim()) as SplitPlan;
  } catch {
    return null;
  }
}

function extractWorkerResult(text: string): WorkerResult | null {
  const match = text.match(/```json:result\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim()) as WorkerResult;
  } catch {
    return null;
  }
}

// ── OrchestratorManager ──

class OrchestratorManager {
  private runs = new Map<string, OrchestrationRuntime>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    if (this.sweepTimer && 'unref' in this.sweepTimer) {
      (this.sweepTimer as NodeJS.Timeout).unref();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════

  async start(
    projectKey: string,
    projectPath: string,
    prompt: string,
  ): Promise<string> {
    const orchId = `orch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const baseBranch = detectDefaultBranch(projectPath);

    const session: OrchestratorSession = {
      id: orchId,
      projectKey,
      originalPrompt: prompt,
      phase: 'pending',
      workers: [],
      baseBranch,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const runtime: OrchestrationRuntime = {
      session,
      workers: new Map(),
      events: [],
      listeners: new Set(),
    };

    this.runs.set(orchId, runtime);
    await this.persistSession(session);

    // Start split phase (fire-and-forget, events stream to listeners)
    this.runSplitPhase(runtime, projectPath, prompt);

    return orchId;
  }

  async confirmSplit(orchId: string, projectPath: string): Promise<void> {
    const runtime = this.getRuntime(orchId);
    if (runtime.session.phase !== 'splitting' || !runtime.session.splitPlan) {
      throw new Error('Split not ready for confirmation');
    }
    await this.runSpawnPhase(runtime, projectPath);
  }

  async confirmMerge(orchId: string, projectPath: string): Promise<void> {
    const runtime = this.getRuntime(orchId);
    if (runtime.session.phase !== 'synthesizing') {
      throw new Error('Not ready for merge');
    }
    await this.runMergePhase(runtime, projectPath);
  }

  subscribe(
    orchId: string,
    since: number,
    listener: (event: OrchestratorSSEEvent, index: number) => void,
  ): (() => void) | null {
    const runtime = this.runs.get(orchId);
    if (!runtime) return null;

    // Replay buffered events
    for (let i = since; i < runtime.events.length; i++) {
      listener(runtime.events[i], i);
    }

    const terminal = runtime.session.phase === 'completed' || runtime.session.phase === 'failed';
    if (terminal) {
      return () => {};
    }

    runtime.listeners.add(listener);
    return () => { runtime.listeners.delete(listener); };
  }

  getStatus(orchId: string): {
    session: OrchestratorSession;
    eventCount: number;
    completedWorkers: number;
  } | null {
    const runtime = this.runs.get(orchId);
    if (!runtime) return null;

    return {
      session: runtime.session,
      eventCount: runtime.events.length,
      completedWorkers: runtime.session.workers.filter(w => w.status === 'completed').length,
    };
  }

  async stop(orchId: string): Promise<boolean> {
    const runtime = this.runs.get(orchId);
    if (!runtime) return false;

    runtime.splitProcess?.kill('SIGTERM');
    runtime.synthesizeProcess?.kill('SIGTERM');

    for (const [, worker] of runtime.workers) {
      worker.process?.kill('SIGTERM');
    }

    await this.transitionPhase(runtime, 'failed', 'Stopped by user');
    this.emitEvent(runtime, { type: 'orch_done' });
    return true;
  }

  async loadSession(orchId: string): Promise<OrchestratorSession | null> {
    // Check memory first
    const runtime = this.runs.get(orchId);
    if (runtime) return runtime.session;

    const data = await readJsonFile<OrchestratorSessionsData>(
      getOrchestratorSessionsPath(),
      DEFAULT_SESSIONS_DATA,
    );
    return data.sessions.find(s => s.id === orchId) ?? null;
  }

  async listSessions(projectKey?: string): Promise<OrchestratorSession[]> {
    const data = await readJsonFile<OrchestratorSessionsData>(
      getOrchestratorSessionsPath(),
      DEFAULT_SESSIONS_DATA,
    );
    const sessions = projectKey
      ? data.sessions.filter(s => s.projectKey === projectKey)
      : data.sessions;
    return sessions.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase Implementations
  // ═══════════════════════════════════════════════════════════════

  private async runSplitPhase(
    runtime: OrchestrationRuntime,
    projectPath: string,
    prompt: string,
  ): Promise<void> {
    await this.transitionPhase(runtime, 'splitting');

    const splitPrompt = buildSplitPrompt(prompt);
    const env = await buildClaudeEnv();
    const modelArgs = await buildClaudeModelArgs();

    const claude = spawnClaude([
      '-p',
      '--output-format', 'stream-json',
      ...modelArgs,
    ], {
      cwd: projectPath,
      shell: true,
      env: { ...env, CLAUDECODE: '' },
    });

    runtime.splitProcess = claude;
    claude.stdin?.write(splitPrompt);
    claude.stdin?.end();

    const lineBuffer = new LineBuffer();
    const streamParser = new StreamParser();
    let fullText = '';

    claude.stdout?.on('data', (chunk: Buffer) => {
      for (const line of lineBuffer.feed(chunk.toString('utf-8'))) {
        for (const event of streamParser.parse(line)) {
          if (event.type === 'text_delta') {
            fullText += event.text;
          }
        }
      }
    });

    claude.on('close', async () => {
      runtime.splitProcess = undefined;

      const remaining = lineBuffer.flush();
      if (remaining) {
        for (const event of streamParser.parse(remaining)) {
          if (event.type === 'text_delta') fullText += event.text;
        }
      }

      const plan = extractSplitPlan(fullText);
      if (plan && plan.tasks.length > 0) {
        runtime.session.splitPlan = plan;
        runtime.session.updatedAt = new Date().toISOString();
        await this.persistSession(runtime.session);
        this.emitEvent(runtime, { type: 'orch_split_completed', plan });
        // Stay in 'splitting' phase — wait for user confirmSplit()
      } else {
        await this.transitionPhase(runtime, 'failed', 'Failed to parse split plan from AI output');
        this.emitEvent(runtime, { type: 'orch_done' });
      }
    });

    claude.on('error', async (err) => {
      runtime.splitProcess = undefined;
      await this.transitionPhase(runtime, 'failed', `Split process error: ${err.message}`);
      this.emitEvent(runtime, { type: 'orch_done' });
    });
  }

  private async runSpawnPhase(
    runtime: OrchestrationRuntime,
    projectPath: string,
  ): Promise<void> {
    await this.transitionPhase(runtime, 'spawning');

    const plan = runtime.session.splitPlan!;
    const orchShort = runtime.session.id.slice(-6);

    // 第一步：创建所有 worktree，建立 branchSlug → workerId 映射
    const slugToWorkerId = new Map<string, string>();

    for (const task of plan.tasks) {
      const workerId = `worker-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`;
      const branch = `task/orch-${orchShort}-${task.branchSlug}`;
      const worktreePath = path.join(projectPath, '.worktrees', `orch-${orchShort}-${task.branchSlug}`);

      try {
        validateBranchName(branch);
        validateWorktreePath(worktreePath, projectPath);
        safeGitWorktreeAdd(worktreePath, branch, runtime.session.baseBranch, projectPath);

        slugToWorkerId.set(task.branchSlug, workerId);

        const worker: WorkerTask = {
          id: workerId,
          orchestrationId: runtime.session.id,
          title: task.title,
          description: task.description,
          gitBranch: branch,
          worktreePath,
          status: 'pending',
          dependsOn: [], // 第二步填充
          eventCount: 0,
        };

        runtime.session.workers.push(worker);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Orch] Failed to create worktree for "${task.title}": ${msg}`);
      }
    }

    if (runtime.session.workers.length === 0) {
      await this.transitionPhase(runtime, 'failed', 'No worktrees could be created');
      this.emitEvent(runtime, { type: 'orch_done' });
      return;
    }

    // 第二步：将 SplitPlan 中的 branchSlug 依赖映射为 workerId 依赖
    for (const task of plan.tasks) {
      const workerId = slugToWorkerId.get(task.branchSlug);
      if (!workerId) continue;
      const worker = runtime.session.workers.find(w => w.id === workerId);
      if (!worker) continue;

      worker.dependsOn = (task.dependsOn ?? [])
        .map(slug => slugToWorkerId.get(slug))
        .filter((id): id is string => id != null);
    }

    await this.persistSession(runtime.session);

    // 进入执行阶段，只启动无依赖（入度为 0）的 worker
    await this.transitionPhase(runtime, 'executing');
    this.scheduleReadyWorkers(runtime);
  }

  private async startWorker(
    runtime: OrchestrationRuntime,
    worker: WorkerTask,
  ): Promise<void> {
    worker.status = 'running';
    worker.startedAt = new Date().toISOString();

    const workerRuntime: WorkerRuntime = {
      workerId: worker.id,
      process: null,
      events: [],
      streamParser: new StreamParser(),
      lineBuffer: new LineBuffer(),
    };

    runtime.workers.set(worker.id, workerRuntime);
    this.emitEvent(runtime, { type: 'worker_started', workerId: worker.id, title: worker.title });

    const workerPrompt = buildWorkerPrompt(
      runtime.session.originalPrompt,
      worker.title,
      worker.description,
    );

    const env = await buildClaudeEnv();
    const modelArgs = await buildClaudeModelArgs();
    const maxTurnsArgs = await buildClaudeMaxTurnsArgs();

    const claude = spawnClaude([
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
      '--dangerously-skip-permissions',
      ...modelArgs,
      ...maxTurnsArgs,
    ], {
      cwd: worker.worktreePath,
      shell: true,
      env: { ...env, CLAUDECODE: '' },
    });

    workerRuntime.process = claude;
    claude.stdin?.write(workerPrompt);
    claude.stdin?.end();

    let fullText = '';

    claude.stdout?.on('data', (chunk: Buffer) => {
      for (const line of workerRuntime.lineBuffer.feed(chunk.toString('utf-8'))) {
        for (const event of workerRuntime.streamParser.parse(line)) {
          workerRuntime.events.push(event);
          worker.eventCount = workerRuntime.events.length;

          if (event.type === 'text_delta') {
            fullText += event.text;
          }

          // Forward every worker event to orchestration listeners
          this.emitEvent(runtime, { type: 'worker_event', workerId: worker.id, event });
        }
      }
    });

    claude.on('close', async (code) => {
      workerRuntime.process = null;

      // Flush remaining buffer
      const remaining = workerRuntime.lineBuffer.flush();
      if (remaining) {
        for (const event of workerRuntime.streamParser.parse(remaining)) {
          if (event.type === 'text_delta') fullText += event.text;
        }
      }

      // Capture Claude session ID
      if (workerRuntime.streamParser.sessionId) {
        worker.claudeSessionId = workerRuntime.streamParser.sessionId;
      }

      // Extract structured result
      const result = extractWorkerResult(fullText);
      if (result && code === 0) {
        worker.status = 'completed';
        worker.result = result;
        this.emitEvent(runtime, { type: 'worker_completed', workerId: worker.id, result });
      } else {
        worker.status = code === 0 ? 'completed' : 'failed';
        if (worker.status === 'completed' && !worker.result) {
          // Completed but no structured result — create a basic one
          worker.result = { status: 'completed', summary: 'Completed (no structured result)', filesChanged: [] };
          this.emitEvent(runtime, { type: 'worker_completed', workerId: worker.id, result: worker.result });
        } else if (worker.status === 'failed') {
          worker.errorMessage = `Exit code ${code}`;
          this.emitEvent(runtime, { type: 'worker_failed', workerId: worker.id, error: worker.errorMessage });
        }
      }

      worker.completedAt = new Date().toISOString();
      runtime.session.updatedAt = new Date().toISOString();
      await this.persistSession(runtime.session);

      this.checkAllWorkersComplete(runtime);
    });

    claude.on('error', async (err) => {
      workerRuntime.process = null;
      worker.status = 'failed';
      worker.errorMessage = err.message;
      worker.completedAt = new Date().toISOString();
      this.emitEvent(runtime, { type: 'worker_failed', workerId: worker.id, error: err.message });
      await this.persistSession(runtime.session);
      this.checkAllWorkersComplete(runtime);
    });
  }

  /**
   * DAG 拓扑调度：找出所有依赖已满足且尚未启动的 worker，立即启动它们。
   * 在初始执行和每个 worker 完成/失败后调用。
   */
  private scheduleReadyWorkers(runtime: OrchestrationRuntime): void {
    const completedIds = new Set(
      runtime.session.workers
        .filter(w => w.status === 'completed' || w.status === 'failed' || w.status === 'stopped')
        .map(w => w.id),
    );

    for (const worker of runtime.session.workers) {
      if (worker.status !== 'pending') continue;

      const depsReady = worker.dependsOn.every(depId => completedIds.has(depId));
      if (depsReady) {
        this.startWorker(runtime, worker);
      }
    }
  }

  private checkAllWorkersComplete(runtime: OrchestrationRuntime): void {
    const allDone = runtime.session.workers.every(
      w => w.status === 'completed' || w.status === 'failed' || w.status === 'stopped',
    );
    if (allDone) {
      this.runSynthesizePhase(runtime);
    } else {
      // 某个 worker 完成了，检查是否有下游 worker 可以启动
      this.scheduleReadyWorkers(runtime);
    }
  }

  private async runSynthesizePhase(
    runtime: OrchestrationRuntime,
  ): Promise<void> {
    await this.transitionPhase(runtime, 'synthesizing');
    this.emitEvent(runtime, { type: 'orch_synthesis_started' });

    const prompt = buildSynthesizePrompt(
      runtime.session.originalPrompt,
      runtime.session.workers,
    );

    const env = await buildClaudeEnv();
    const modelArgs = await buildClaudeModelArgs();

    // Use the first worker's project path (go up from worktree) or baseBranch cwd
    // For synthesis we don't need tools, just use any valid cwd
    const anyCwd = runtime.session.workers[0]?.worktreePath
      ?? process.cwd();

    const claude = spawnClaude([
      '-p',
      '--output-format', 'stream-json',
      ...modelArgs,
    ], {
      cwd: anyCwd,
      shell: true,
      env: { ...env, CLAUDECODE: '' },
    });

    runtime.synthesizeProcess = claude;
    claude.stdin?.write(prompt);
    claude.stdin?.end();

    const lineBuffer = new LineBuffer();
    const streamParser = new StreamParser();
    let fullText = '';

    claude.stdout?.on('data', (chunk: Buffer) => {
      for (const line of lineBuffer.feed(chunk.toString('utf-8'))) {
        for (const event of streamParser.parse(line)) {
          if (event.type === 'text_delta') fullText += event.text;
        }
      }
    });

    claude.on('close', async () => {
      runtime.synthesizeProcess = undefined;

      const remaining = lineBuffer.flush();
      if (remaining) {
        for (const event of streamParser.parse(remaining)) {
          if (event.type === 'text_delta') fullText += event.text;
        }
      }

      runtime.session.synthesisResult = fullText || '(No synthesis output)';
      runtime.session.updatedAt = new Date().toISOString();
      await this.persistSession(runtime.session);
      this.emitEvent(runtime, { type: 'orch_synthesis_completed', summary: runtime.session.synthesisResult });
      // Stay in 'synthesizing' phase — wait for user confirmMerge()
    });

    claude.on('error', async (err) => {
      runtime.synthesizeProcess = undefined;
      await this.transitionPhase(runtime, 'failed', `Synthesis error: ${err.message}`);
      this.emitEvent(runtime, { type: 'orch_done' });
    });
  }

  private async runMergePhase(
    runtime: OrchestrationRuntime,
    projectPath: string,
  ): Promise<void> {
    await this.transitionPhase(runtime, 'merging');

    const mergedBranches: string[] = [];

    try {
      safeGitCheckout(runtime.session.baseBranch, projectPath);

      for (const worker of runtime.session.workers) {
        if (worker.status !== 'completed') continue;

        try {
          // Remove worktree first (so branch is not checked out)
          try {
            safeGitWorktreeRemove(worker.worktreePath, projectPath, true);
          } catch {
            // Worktree may already be removed
          }

          safeGitMerge(worker.gitBranch, projectPath, `merge: ${worker.title}`);
          mergedBranches.push(worker.gitBranch);

          // Clean up branch after successful merge
          try {
            safeGitDeleteBranch(worker.gitBranch, projectPath);
          } catch {
            // Non-critical
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[Orch] Failed to merge ${worker.gitBranch}: ${msg}`);
          // Don't fail the whole merge — continue with other branches
        }
      }

      // Clean up remaining worktrees for failed workers
      for (const worker of runtime.session.workers) {
        if (worker.status !== 'completed') {
          try {
            safeGitWorktreeRemove(worker.worktreePath, projectPath, true);
          } catch { /* ignore */ }
          try {
            safeGitDeleteBranch(worker.gitBranch, projectPath, true);
          } catch { /* ignore */ }
        }
      }

      runtime.session.mergeStatus = mergedBranches.length > 0 ? 'completed' : 'conflict';
      runtime.session.completedAt = new Date().toISOString();
      runtime.completedAt = Date.now();

      await this.transitionPhase(runtime, 'completed');
      this.emitEvent(runtime, { type: 'orch_merge_completed', branches: mergedBranches });
      this.emitEvent(runtime, { type: 'orch_done' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      runtime.session.mergeStatus = 'conflict';
      await this.transitionPhase(runtime, 'failed', `Merge failed: ${msg}`);
      this.emitEvent(runtime, { type: 'orch_done' });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  private getRuntime(orchId: string): OrchestrationRuntime {
    const runtime = this.runs.get(orchId);
    if (!runtime) throw new Error(`Orchestration ${orchId} not found`);
    return runtime;
  }

  private async transitionPhase(
    runtime: OrchestrationRuntime,
    phase: OrchestratorPhase,
    errorMessage?: string,
  ): Promise<void> {
    runtime.session.phase = phase;
    if (errorMessage) {
      runtime.session.errorMessage = errorMessage;
      this.emitEvent(runtime, { type: 'orch_error', message: errorMessage });
    }
    if (!runtime.session.startedAt && phase !== 'pending') {
      runtime.session.startedAt = new Date().toISOString();
    }
    runtime.session.updatedAt = new Date().toISOString();
    await this.persistSession(runtime.session);
    this.emitEvent(runtime, { type: 'orch_phase_changed', phase });
  }

  private emitEvent(runtime: OrchestrationRuntime, event: OrchestratorSSEEvent): void {
    const index = runtime.events.length;
    runtime.events.push(event);
    for (const listener of runtime.listeners) {
      try { listener(event, index); } catch { /* listener cleanup */ }
    }
  }

  private async persistSession(session: OrchestratorSession): Promise<void> {
    await modifyJsonFile<OrchestratorSessionsData>(
      getOrchestratorSessionsPath(),
      DEFAULT_SESSIONS_DATA,
      (data) => {
        const idx = data.sessions.findIndex(s => s.id === session.id);
        if (idx >= 0) {
          data.sessions[idx] = session;
        } else {
          data.sessions.push(session);
        }
        return data;
      },
    );
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, runtime] of this.runs) {
      if (runtime.completedAt && now - runtime.completedAt > COMPLETED_TTL_MS) {
        this.runs.delete(id);
      }
    }
  }
}

// ── Singleton ──

const globalForOrch = globalThis as unknown as {
  __orchestratorManager?: OrchestratorManager;
};

export const orchestratorManager =
  globalForOrch.__orchestratorManager ?? new OrchestratorManager();

if (process.env.NODE_ENV !== 'production') {
  globalForOrch.__orchestratorManager = orchestratorManager;
}
