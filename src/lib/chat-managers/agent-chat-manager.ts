/**
 * AgentChatManager — 基于 Claude Agent SDK query() 的 Agent 会话管理器。
 *
 * 直接使用 SDK 的 query() 函数替代 CLI 子进程方式。
 * 不再继承 BaseChatManager（BaseChatManager 保留给 Task Worker 使用）。
 *
 * 核心变化：
 * - spawnClaude() + NDJSON → query() + SdkEventAdapter
 * - ChildProcess → Query (SDK AsyncGenerator)
 * - buildClaudeEnv + CLI args → buildSdkQueryOptions()
 * - StreamParser → SdkEventAdapter
 */

import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { getAppWorkingDir } from '@/lib/app-paths';
import { getPromptFilePath, getContextIndexPath, readJsonFile } from '@/lib/file-store';
import type { ContextIndexData } from '@/types';
import { resolveSystemPrompt, createRuntimePromptCopy } from '@/lib/agent-prompt-store';
import { resolveSkillsForSession } from '@/lib/skill-store';
import { getSettings } from '@/lib/settings-manager';
import { createAgentRunner, type IAgentRunner } from './agent-runner';
import { detectDangerousCommand } from '@/lib/danger-detector';
import type { ChatSSEEvent, ContentBlock, Agent, AgentCapabilities, ProviderId } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES, DEFAULT_DANGER_SETTINGS } from '@/types';
import type { AgentChatSession, SessionConfig } from '@/types/agent-chat';
import type { ResourceRef, InlineTextRef, FlowContextRef, ReferenceTurnsRef } from '@/types/resource';
import { resourceRegistry } from '@/lib/resource-registry';
import '@/lib/resource-loaders'; // side-effect: registers non-action loaders
import '@/lib/agent-actions';    // side-effect: registers actions + their loaders
import { actionRegistry } from '@/lib/agent-actions';
import { estimateTokens } from '@/lib/token-estimate';
import { migrateAgentToResources } from '@/lib/resource-migration';
import type { SystemPromptLoaderContext } from '@/lib/resource-loaders/system-prompt-loader';
import { checkSessionHealth, buildGuardMessage } from './session-health-guard';
import { shouldGenerateTitle, generateSessionTitle } from '@/lib/session-title-generator';
import type { RunStatus, RunStatusInfo } from './types';

// Re-export store functions so existing callers don't break during migration
export { generateSessionId } from './agent-chat-session-store';

// Import store functions for internal use
import {
  loadSession,
  loadAgent,
  eagerlySaveUserTurn,
  persistSessionToDisk,
  incrementGuardRetryCountOnDisk,
  deleteSessionFromDisk,
  updateConfigOnDisk,
} from './agent-chat-session-store';

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

/** ChatToolCall 类型（与 UI 事件对齐） */
interface ChatToolCall {
  id: string;
  toolName: string;
  input: string;
  output?: string;
  status: 'running' | 'completed' | 'failed';
}

export interface AgentChatRun {
  runId: string;
  sessionId: string;
  agentId: string;
  projectKey?: string;
  sessionTitle?: string;

  /** 当前运行的 SDK runner（统一 Claude Agent SDK / Codex SDK 抽象） */
  runner: IAgentRunner | null;

  // Run lifecycle
  status: RunStatus;
  startedAt: number;
  completedAt?: number;

  // Event streaming
  events: ChatSSEEvent[];
  listeners: Set<(event: ChatSSEEvent, index: number) => void>;

  // Accumulation
  assistantText: string;
  contentBlocks: ContentBlock[];
  toolCalls: ChatToolCall[];

  // Resume support
  claudeSessionId?: string;

  // Danger detector settings snapshot
  dangerSettings?: import('@/types').DangerDetectorSettings;

  // Session data
  messages: Array<{ role: 'user' | 'assistant'; content: string; images?: string[]; contentBlocks?: ContentBlock[] }>;
  config?: SessionConfig;
  parentSessionId?: string;
  importedTurnIndices?: number[];
  _tempImagePaths?: string[];
  _guardRetryCount?: number;
  /** 临时测试会话，不持久化到会话列表 */
  _ephemeral?: boolean;
}

// ── Constants ──

const SWEEP_INTERVAL_MS = 60_000;
const COMPLETED_TTL_MS = 10 * 60 * 1000; // 10 minutes
const LOG_PREFIX = '[AgentChat]';

// ── AgentChatManager ──

class AgentChatManager {
  private runs = new Map<string, AgentChatRun>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    if (this.sweepTimer && typeof this.sweepTimer === 'object' && 'unref' in this.sweepTimer) {
      this.sweepTimer.unref();
    }
  }

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
    providerOverride?: ProviderId,
    modelOverride?: string,
    effortOverride?: string,
    ephemeral?: boolean,
    _depth?: number,
  ): Promise<string> {
    const agent = await loadAgent(agentId);

    let existing = this.runs.get(sessionId);

    // Hydrate from disk if not in memory
    if (!existing) {
      const diskSession = await loadSession(sessionId);
      if (diskSession) {
        existing = this.hydrateFromDisk(diskSession);
        this.runs.set(sessionId, existing);
      }
    }

    if (existing?.status === 'running') {
      throw new Error('This session is already running');
    }

    const messages = existing?.messages ? [...existing.messages] : [];
    const dataUrls = images?.map(img => `data:${img.mediaType};base64,${img.data}`);
    messages.push({ role: 'user', content: message, images: dataUrls?.length ? dataUrls : undefined });

    const sessionConfig = initialConfig ?? existing?.config;

    // ── Resolve provider / model with priority chain ──
    const resolvedProvider = providerOverride
      || sessionConfig?.provider
      || agent.defaultProvider
      || undefined;
    const resolvedModel = modelOverride
      || sessionConfig?.model
      || agent.defaultModel
      || undefined;

    // 切换 provider/model 后，旧的 resume session 可能不兼容（常见于同会话切换渠道）。
    // 这种情况下必须放弃 resume，避免 Claude SDK 直接 error_during_execution / code 1。
    const prevProvider = existing?.config?.provider;
    const prevModel = existing?.config?.model;
    const hasResumeId = !!existing?.claudeSessionId;
    const lastRole = existing?.messages?.[existing.messages.length - 1]?.role;
    const previousTurnIncomplete = lastRole === 'user';
    const providerChanged =
      hasResumeId && !!prevProvider && !!resolvedProvider && prevProvider !== resolvedProvider;
    const modelChanged =
      hasResumeId && !!prevModel && !!resolvedModel && prevModel !== resolvedModel;
    const isResume = hasResumeId && !providerChanged && !modelChanged && !previousTurnIncomplete;
    const resumeSessionId = isResume ? existing?.claudeSessionId : undefined;

    // Persist resolved provider/model into session config
    const persistedConfig: SessionConfig = {
      ...sessionConfig,
      ...(resolvedProvider ? { provider: resolvedProvider } : {}),
      ...(resolvedModel ? { model: resolvedModel } : {}),
    };

    // OpenAI 协议的自定义供应商暂不支持 Agent Chat（仅内置 openai 支持 Codex CLI）
    if (resolvedProvider?.startsWith('custom-')) {
      const settings = await getSettings();
      const cp = settings.claude.customProviders?.find((c) => c.id === resolvedProvider);
      if (cp?.apiProtocol === 'openai') {
        throw new Error(
          'OpenAI 协议的自定义供应商暂不支持 Agent 对话。请使用 Anthropic 协议的自定义供应商或切换至内置 OpenAI。',
        );
      }
    }

    // Build prompt
    const sessionProjectKey = flowContext?.projectKey ?? existing?.projectKey;

    let promptContent: string;
    if (flowContext) {
      promptContent = await buildAgentChatPromptWithFlowContext(agent, message, flowContext, persistedConfig, sessionId);
    } else {
      promptContent = await buildAgentChatPrompt(agent, message, persistedConfig, sessionId, sessionProjectKey);
    }

    // Write images to temp files
    const tempPaths: string[] = [];
    const extMap: Record<string, string> = {
      'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
    };
    if (images && images.length > 0) {
      for (const img of images) {
        const ext = extMap[img.mediaType] ?? 'png';
        const tmpPath = join(tmpdir(), `agent-img-${randomBytes(8).toString('hex')}.${ext}`);
        await writeFile(tmpPath, Buffer.from(img.data, 'base64'));
        tempPaths.push(tmpPath);
      }
    }

    // Merge capabilities
    const effectiveCaps = mergeCapabilities(agent.capabilities, persistedConfig?.capabilities);

    // Eagerly save user turn before starting query
    if (!ephemeral) {
      await eagerlySaveUserTurn({
        sessionId,
        agentId,
        projectKey: flowContext?.projectKey ?? existing?.projectKey,
        sessionTitle: existing?.sessionTitle ?? initialTitle,
        messages,
        claudeSessionId: resumeSessionId,
        config: persistedConfig,
        parentSessionId: parentSessionId ?? existing?.parentSessionId,
        importedTurnIndices: undefined,
      });
    }

    // ── Create run ──
    const runId = `run-${sessionId}-${Date.now()}`;
    const run: AgentChatRun = {
      runId,
      sessionId,
      agentId,
      projectKey: flowContext?.projectKey ?? existing?.projectKey,
      sessionTitle: existing?.sessionTitle ?? initialTitle,
      runner: null,
      status: 'running',
      startedAt: Date.now(),
      events: [],
      listeners: new Set(),
      assistantText: '',
      contentBlocks: [],
      toolCalls: [],
      claudeSessionId: resumeSessionId,
      messages,
      config: persistedConfig,
      parentSessionId: parentSessionId ?? existing?.parentSessionId,
      _tempImagePaths: tempPaths,
      _guardRetryCount: existing?._guardRetryCount,
      _ephemeral: ephemeral,
    };

    // Snapshot danger detector settings
    try {
      const settings = await getSettings();
      run.dangerSettings = settings.dangerDetector ?? DEFAULT_DANGER_SETTINGS;
    } catch {
      run.dangerSettings = DEFAULT_DANGER_SETTINGS;
    }

    this.runs.set(sessionId, run);

    // ── Launch runner（provider 无关）──
    try {
      const runner = await createAgentRunner({
        provider: resolvedProvider ?? 'anthropic',
        capabilities: effectiveCaps,
        model: resolvedModel,
        effortOverride,
        resumeSessionId,
        cwd: getAppWorkingDir(),
      });
      run.runner = runner;

      this.consumeRunnerStream(run, runner, promptContent).catch(err => {
        console.error(`${LOG_PREFIX} Runner stream error for ${sessionId}:`, err);
      });
    } catch (err) {
      this.trackAndEmit(run, { type: 'error', message: `Failed to start runner: ${err instanceof Error ? err.message : String(err)}` });
      this.trackAndEmit(run, { type: 'done' });
      run.status = 'failed';
      run.completedAt = Date.now();
      run.runner = null;
      await this.persistAfterClose(run, false);
    }

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
    const hostSession = await loadSession(parentSessionId);
    if (!hostSession) {
      throw new Error('Host session not found');
    }

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

    const agent = await loadAgent(agentId);

    const existing = this.runs.get(guestSessionId);
    if (existing?.status === 'running') {
      throw new Error('This guest session is already running');
    }

    const isResume = !!existing?.claudeSessionId;
    const messages = existing?.messages ? [...existing.messages] : [];
    messages.push({ role: 'user', content: message });

    const promptContent = await buildGuestAgentPrompt(agent, message, selectedTurns);

    // ── Resolve provider — host session config → agent default → anthropic ──
    const resolvedProvider: ProviderId =
      hostSession.config?.provider
      ?? agent.defaultProvider
      ?? 'anthropic';

    // Create run
    const runId = `run-${guestSessionId}-${Date.now()}`;
    const run: AgentChatRun = {
      runId,
      sessionId: guestSessionId,
      agentId,
      sessionTitle: existing?.sessionTitle,
      runner: null,
      status: 'running',
      startedAt: Date.now(),
      events: [],
      listeners: new Set(),
      assistantText: '',
      contentBlocks: [],
      toolCalls: [],
      claudeSessionId: existing?.claudeSessionId,
      messages,
      parentSessionId,
      importedTurnIndices: turnIndices,
    };

    // Snapshot danger detector settings
    try {
      const settings = await getSettings();
      run.dangerSettings = settings.dangerDetector ?? DEFAULT_DANGER_SETTINGS;
    } catch {
      run.dangerSettings = DEFAULT_DANGER_SETTINGS;
    }

    this.runs.set(guestSessionId, run);

    // ── Launch runner（provider 无关）──
    try {
      const runner = await createAgentRunner({
        provider: resolvedProvider,
        capabilities: agent.capabilities,
        model: agent.defaultModel,
        resumeSessionId: isResume ? existing?.claudeSessionId : undefined,
        cwd: getAppWorkingDir(),
      });
      run.runner = runner;

      this.consumeRunnerStream(run, runner, promptContent).catch(err => {
        console.error(`${LOG_PREFIX} Runner stream error for guest ${guestSessionId}:`, err);
      });
    } catch (err) {
      this.trackAndEmit(run, { type: 'error', message: `Failed to start runner: ${err instanceof Error ? err.message : String(err)}` });
      this.trackAndEmit(run, { type: 'done' });
      run.status = 'failed';
      run.completedAt = Date.now();
      run.runner = null;
    }

    return run.runId;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Public: in-memory state queries
  // ═══════════════════════════════════════════════════════════════════════

  subscribe(
    runKey: string,
    since: number,
    listener: (event: ChatSSEEvent, index: number) => void,
  ): (() => void) | null {
    const run = this.runs.get(runKey);
    if (!run) return null;

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

  getStatus(runKey: string): RunStatusInfo {
    const run = this.runs.get(runKey);
    if (!run) {
      return { status: 'none', eventCount: 0 };
    }
    const lastError = run.events.filter((e): e is { type: 'error'; message: string } =>
      e.type === 'error' && 'message' in e
    ).pop();
    return {
      status: run.status,
      runId: run.runId,
      eventCount: run.events.length,
      startedAt: new Date(run.startedAt).toISOString(),
      errorMessage: lastError?.message,
    };
  }

  async stop(runKey: string): Promise<boolean> {
    const run = this.runs.get(runKey);
    if (!run || run.status !== 'running') return false;
    run.status = 'stopped';
    run.runner?.abort();
    run.runner = null;
    return true;
  }

  getMessages(sessionId: string): Array<{ role: 'user' | 'assistant'; content: string }> {
    const run = this.runs.get(sessionId);
    if (!run) return [];
    return run.messages;
  }

  getRunningForAgent(agentId: string): string | null {
    for (const [, run] of this.runs) {
      if (run.agentId === agentId && run.status === 'running') {
        return run.sessionId;
      }
    }
    return null;
  }

  getRunningForProject(projectKey: string): string | null {
    for (const [, run] of this.runs) {
      if (run.projectKey === projectKey && run.status === 'running') {
        return run.sessionId;
      }
    }
    return null;
  }

  clear(sessionId: string): void {
    const run = this.runs.get(sessionId);
    if (run?.status === 'running') return;
    this.runs.delete(sessionId);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Public: hybrid methods (this.runs + disk)
  // ═══════════════════════════════════════════════════════════════════════

  async deleteSession(sessionId: string): Promise<boolean> {
    this.clear(sessionId);
    return deleteSessionFromDisk(sessionId);
  }

  async updateConfig(sessionId: string, config: SessionConfig): Promise<boolean> {
    const run = this.runs.get(sessionId);
    if (run) {
      run.config = config;
    }
    return updateConfigOnDisk(sessionId, config);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Private: runner stream consumption
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * 统一的 runner 流消费逻辑。
   * ClaudeAgentRunner / CodexAgentRunner 都经由此处驱动，AgentChatManager 不感知差异。
   */
  private async consumeRunnerStream(
    run: AgentChatRun,
    runner: IAgentRunner,
    prompt: string,
  ): Promise<void> {
    try {
      for await (const event of runner.stream(prompt)) {
        if (run.status === 'stopped') break;
        this.trackAndEmit(run, event);
      }
    } catch (err) {
      if (run.status !== 'stopped') {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.trackAndEmit(run, { type: 'error', message: errMsg });
      }
    }

    const aborted = run.status === 'stopped';
    run.runner = null;

    if (runner.capturedSessionId) {
      run.claudeSessionId = runner.capturedSessionId;
    }

    await this.finalizeRun(run, aborted);
  }

  /**
   * 流结束后的统一收尾逻辑（Claude SDK 和 Codex SDK 共享）。
   * 清理临时文件 → 处理 Agent Actions → 生成标题 → 持久化 → emit done。
   */
  private async finalizeRun(run: AgentChatRun, aborted: boolean): Promise<void> {
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
        projectKey: run.projectKey,
        emit: (event: ChatSSEEvent) => this.trackAndEmit(run, event),
        setSessionTitle: (title: string) => { if (!run.sessionTitle) run.sessionTitle = title; },
      };

      const cleaned = await actionRegistry.processResponse(run.assistantText, actionCtx);

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

      // Async title generation
      const assistantTurnCount = run.messages.filter(m => m.role === 'assistant').length;
      if (shouldGenerateTitle(assistantTurnCount)) {
        try {
          const aiTitle = await generateSessionTitle(
            run.messages.map(m => ({ role: m.role, content: m.content })),
            run.sessionTitle,
          );
          if (aiTitle) run.sessionTitle = aiTitle;
        } catch (err) {
          console.error(`${LOG_PREFIX} Title generation failed:`, err);
        }
      }

      if (!run.sessionTitle) {
        const firstUserMsg = run.messages.find(m => m.role === 'user')?.content;
        const defaultTitle = run.parentSessionId ? '旁听会话' : '新会话';
        run.sessionTitle = firstUserMsg ? firstUserMsg.slice(0, 30) + '...' : defaultTitle;
      }

      this.trackAndEmit(run, { type: 'session_title_set', title: run.sessionTitle });
    }

    if (run.status === 'running') {
      run.status = aborted ? 'stopped' : 'completed';
    }
    run.completedAt = Date.now();

    // 如果本轮在执行阶段直接失败且没有任何新输出，通常是 resume 上下文损坏或与当前渠道不兼容。
    // 清空 claudeSessionId，避免用户后续每次重试都复用同一坏会话而持续 code 1。
    const hasExecutionError = run.events.some(
      (e) =>
        e.type === 'error'
        && (
          e.message.includes('error_during_execution')
          || e.message.includes('process exited with code 1')
          || e.message.includes('Claude Code process exited with code 1')
        ),
    );
    if (!aborted && !run.assistantText.trim() && hasExecutionError) {
      run.claudeSessionId = undefined;
    }

    try {
      await this.persistAfterClose(run, aborted);
    } catch (err) {
      console.error(`${LOG_PREFIX} persistAfterClose error:`, err);
    }

    this.trackAndEmit(run, { type: 'done' });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Private: event tracking + broadcast
  // ═══════════════════════════════════════════════════════════════════════

  private trackAndEmit(run: AgentChatRun, event: ChatSSEEvent): void {
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

      // Danger detection
      if (event.toolName === 'Bash') {
        const danger = detectDangerousCommand(event.input, run.dangerSettings);
        if (danger) {
          const warningEvent: ChatSSEEvent = {
            type: 'dangerous_tool_warning',
            toolCallId: event.id,
            toolName: event.toolName,
            command: event.input,
            reason: danger.reason,
            level: danger.level,
          };
          const wIdx = run.events.length;
          run.events.push(warningEvent);
          for (const listener of run.listeners) {
            try { listener(warningEvent, wIdx); } catch { /* */ }
          }

          if (danger.level === 'critical') {
            console.warn(`${LOG_PREFIX} CRITICAL danger detected, auto-stopping: ${danger.reason}`);
            run.status = 'stopped';
            run.runner?.abort();
            run.runner = null;
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

  // ═══════════════════════════════════════════════════════════════════════
  // Private: persistence
  // ═══════════════════════════════════════════════════════════════════════

  private async persistAfterClose(run: AgentChatRun, _aborted: boolean): Promise<void> {
    if (run._ephemeral) return;

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
    await persistSessionToDisk(session);

    // Session Health Guard
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

        const memRun = this.runs.get(run.sessionId);
        // 竞态：用户可能在 Health Guard 检查期间已发送新消息，会话已在运行
        if (memRun?.status === 'running') {
          console.log(`${LOG_PREFIX} Session ${run.sessionId} already running (user retried), skip resume`);
          return;
        }
        if (memRun) {
          memRun._guardRetryCount = (memRun._guardRetryCount ?? 0) + 1;
        }
        await incrementGuardRetryCountOnDisk(run.sessionId);

        const guardMsg = buildGuardMessage(run.status, result.reason);
        try {
          await this.start(run.sessionId, run.agentId, guardMsg);
          console.log(`${LOG_PREFIX} Health guard resumed session ${run.sessionId}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('already running')) {
            console.log(`${LOG_PREFIX} Session ${run.sessionId} already running (race), skip resume`);
          } else {
            console.error(`${LOG_PREFIX} Health guard failed to resume session:`, err);
          }
        }
      }).catch(err => console.error(`${LOG_PREFIX} Health guard error:`, err));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Private helpers
  // ═══════════════════════════════════════════════════════════════════════

  private hydrateFromDisk(diskSession: AgentChatSession): AgentChatRun {
    return {
      runId: '',
      sessionId: diskSession.id,
      agentId: diskSession.agentId,
      projectKey: diskSession.projectKey,
      runner: null,
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

// ── Capability Merge Helper ──

function mergeCapabilities(
  agentCaps?: AgentCapabilities,
  sessionCaps?: Partial<AgentCapabilities>,
): AgentCapabilities {
  const base = { ...DEFAULT_AGENT_CAPABILITIES, ...agentCaps };
  if (!sessionCaps) return base;
  const merged = { ...base };
  for (const key of Object.keys(sessionCaps) as Array<keyof AgentCapabilities>) {
    if (sessionCaps[key] === undefined) continue;
    merged[key] = base[key] ? sessionCaps[key]! : false;
  }
  return merged;
}

// ── Unified Resource-based Prompt Builder ──

async function buildResourcePrompt(
  agent: Agent,
  extraRefs?: ResourceRef[],
  sessionConfig?: SessionConfig,
  sessionId?: string,
  projectKey?: string,
): Promise<string> {
  const baseRefs = agent.defaultResources ?? migrateAgentToResources(agent);
  const merged: ResourceRef[] = [...baseRefs];

  merged.push({ type: 'global-prompt', id: '_global', priority: 1 });

  if (projectKey) {
    merged.push({ type: 'project-prompt', id: '_project', priority: 2 });
  }

  if (projectKey) {
    const existingCtxIds = new Set([
      ...(baseRefs.filter(r => r.type === 'context').map(r => r.id)),
      ...(sessionConfig?.contextIds ?? []),
    ]);
    const agentTags = agent.contextTags;
    const ctxIndex = await readJsonFile<ContextIndexData>(getContextIndexPath(), { entries: [] });
    for (const entry of ctxIndex.entries) {
      if (entry.projectKey !== projectKey) continue;
      if (entry.status && entry.status !== 'active') continue;
      if (existingCtxIds.has(entry.id)) continue;
      if (agentTags?.length && (!entry.tags?.length || !entry.tags.some(t => agentTags.includes(t)))) continue;
      merged.push({ type: 'context', id: entry.id, priority: 32, injectMode: 'summary' });
    }
  }

  if (extraRefs) merged.push(...extraRefs);

  // ── Auto-inject scoped skills (global → project → agent cascade) ──
  {
    const sessionSkillNames = new Set(sessionConfig?.skillNames ?? []);
    const resolved = await resolveSkillsForSession({
      agentId: agent.id,
      projectKey,
    });
    for (const rs of resolved) {
      // Session-level explicit skills override; skip duplicates
      if (sessionSkillNames.has(rs.name) || sessionSkillNames.has(rs.qualifiedId)) continue;
      merged.push({ type: 'skill', id: rs.qualifiedId, priority: 50 });
    }
  }

  if (sessionConfig) {
    if (sessionConfig.contextIds?.length) {
      for (const cid of sessionConfig.contextIds) {
        merged.push({ type: 'context', id: cid, priority: 35 });
      }
    }
    if (sessionConfig.skillNames?.length) {
      for (const name of sessionConfig.skillNames) {
        merged.push({ type: 'skill', id: name, priority: 52 });
      }
    }
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

  const resolved = sessionConfig?.systemPrompt?.trim()
    ? sessionConfig.systemPrompt.trim()
    : await resolveSystemPrompt(agent.id, agent.systemPrompt);
  const systemPromptText = resolved
    || `你是一个名为「${agent.name}」的 AI 助手。${agent.description || ''}`;

  const effectiveCaps = mergeCapabilities(agent.capabilities, sessionConfig?.capabilities);

  let runtimePromptPath: string | undefined;
  if (effectiveCaps.exposePromptPath && sessionId) {
    runtimePromptPath = await createRuntimePromptCopy(agent.id, sessionId);
  }

  const ctx: SystemPromptLoaderContext = {
    agentId: agent.id,
    projectKey,
    systemPromptText,
    promptFilePath: effectiveCaps.exposePromptPath ? getPromptFilePath(agent.id) : undefined,
    runtimePromptPath,
  };

  const resolvedResources = await resourceRegistry.resolveAll(allRefs, ctx);
  return resourceRegistry.formatAsPrompt(resolvedResources);
}

// ── Prompt Builders (powered by Resource Registry) ──

async function buildAgentChatPrompt(agent: Agent, message: string, sessionConfig?: SessionConfig, sessionId?: string, projectKey?: string): Promise<string> {
  const resourcePrompt = await buildResourcePrompt(agent, undefined, sessionConfig, sessionId, projectKey);

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

  const resourcePrompt = await buildResourcePrompt(agent, [flowRef], sessionConfig, sessionId, projectKey);

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

// ── Prompt Preview ──

/**
 * 构建 Agent 的完整系统提示词（不含用户消息），返回字符数和估算 token 数。
 * 供 /api/agent-chat/prompt-info 端点调用，用于在 UI 中展示提示词大小。
 *
 * @param agentId    Agent ID
 * @param sessionId  会话 ID（可选，用于运行时提示词副本路径）
 * @param projectKey 项目 key（可选，影响上下文注入）
 * @param config     会话配置（可选）
 */
export async function buildPromptPreview(
  agentId: string,
  sessionId?: string,
  projectKey?: string,
  config?: import('@/types/agent-chat').SessionConfig,
): Promise<{ charCount: number; estimatedTokens: number }> {
  const agent = await loadAgent(agentId);
  const promptText = await buildResourcePrompt(agent, undefined, config, sessionId, projectKey);
  return {
    charCount: promptText.length,
    estimatedTokens: estimateTokens(promptText),
  };
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
