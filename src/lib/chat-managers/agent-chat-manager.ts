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

import { getAppWorkingDir } from '@/lib/app-paths';
import { getPromptFilePath, getContextIndexPath, getContextDir, getTodosPath, readJsonFile } from '@/lib/file-store';
import { matchCodeCards, buildCodeCardIndex } from '@/lib/code-card-matcher';
import { listRunningTasks } from '@/lib/active-tasks';
import type { ContextIndexData, TodosData } from '@/types';
import { resolveSystemPrompt, createRuntimePromptCopy } from '@/lib/agent-prompt-store';
import { resolveSkillsForSession } from '@/lib/skill-store';
import { getSettings } from '@/lib/settings-manager';
import { createAgentRunner, type IAgentRunner } from './agent-runner';
import { detectDangerousCommand } from '@/lib/danger-detector';
import type { ChatSSEEvent, ContentBlock, Agent, AgentCapabilities, ProviderId } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES, DEFAULT_DANGER_SETTINGS } from '@/types';
import type { AgentChatSession, SessionConfig, SessionCheckpoint } from '@/types/agent-chat';
import type { ResourceRef, InlineTextRef, FlowContextRef, ReferenceTurnsRef } from '@/types/resource';
import { resourceRegistry } from '@/lib/resource-registry';
import { formatConversationHistory } from './conversation-history';
import '@/lib/resource-loaders'; // side-effect: registers non-action loaders
import '@/lib/agent-actions';    // side-effect: registers actions + their loaders
import { actionRegistry } from '@/lib/agent-actions';
import { estimateTokens } from '@/lib/token-estimate';
import { migrateAgentToResources } from '@/lib/resource-migration';
import { updateAgentStatus } from '@/lib/agents-store';
import type { SystemPromptLoaderContext } from '@/lib/resource-loaders/system-prompt-loader';
import { runSatelliteTasks } from '@/lib/satellite-tasks';
import '@/lib/satellite-tasks'; // side-effect: registers all satellite tasks
import type { SatelliteContext } from '@/lib/satellite-tasks';
import type { RunStatus, RunStatusInfo } from './types';
import { appendUsageRecord } from '@/lib/usage-store';

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
  writeStreamingDraft,
  deleteStreamingDraft,
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
  _images?: ImageAttachment[];
  _guardRetryCount?: number;
  /** 临时测试会话，不持久化到会话列表 */
  _ephemeral?: boolean;
  /** 会话检查点（context window 快满时由 AI 生成） */
  checkpoint?: import('@/types/agent-chat').SessionCheckpoint;
  /** Throttle timestamp for streaming draft writes (crash recovery) */
  _lastDraftWriteTs?: number;

  // Token usage tracking (accumulated from token_usage events)
  _tokenInputs: number;
  _tokenOutputs: number;
  _contextWindow?: number;

  /**
   * Resolves when consumeRunnerStream() (including finalizeRun) has completed.
   * Used by stop() to wait for graceful shutdown before returning to the caller.
   */
  _completionPromise?: Promise<void>;
  _resolveCompletion?: () => void;
}

// ── Constants ──

const SWEEP_INTERVAL_MS = 60_000;
const COMPLETED_TTL_MS = 10 * 60 * 1000; // 10 minutes
const STREAMING_DRAFT_INTERVAL_MS = 2_000; // Write streaming draft every 2s for crash recovery
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
    background?: boolean,
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

    // 当 resume 不可用但存在历史消息时，将历史对话注入 prompt
    // 这样即使 SDK 会话是全新的，AI 也能知道之前聊过什么
    const existingMessages = existing?.messages ?? [];
    const conversationHistory = (!resumeSessionId && existingMessages.length > 0)
      ? formatConversationHistory(existingMessages, existing?.checkpoint ?? undefined)
      : undefined;

    if (conversationHistory && !resumeSessionId && existingMessages.length > 0) {
      console.log(`${LOG_PREFIX} [${sessionId}] Resume unavailable, injecting ${existingMessages.length} messages as conversation history`);
    }

    let promptContent: string;
    if (flowContext) {
      promptContent = await buildAgentChatPromptWithFlowContext(agent, message, flowContext, persistedConfig, sessionId, conversationHistory ?? undefined);
    } else {
      promptContent = await buildAgentChatPrompt(agent, message, persistedConfig, sessionId, sessionProjectKey, conversationHistory ?? undefined);
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
        background: background || undefined,
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
      _images: images,
      _guardRetryCount: existing?._guardRetryCount,
      _ephemeral: ephemeral,
      _tokenInputs: 0,
      _tokenOutputs: 0,
    };

    // Snapshot danger detector settings
    try {
      const settings = await getSettings();
      run.dangerSettings = settings.dangerDetector ?? DEFAULT_DANGER_SETTINGS;
    } catch {
      run.dangerSettings = DEFAULT_DANGER_SETTINGS;
    }

    this.runs.set(sessionId, run);

    // Update agent status to busy (fire-and-forget)
    updateAgentStatus(agentId, {
      state: 'busy',
      lastActiveAt: new Date().toISOString(),
      lastSessionId: sessionId,
    }).catch(() => {});

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

      run._completionPromise = new Promise<void>(resolve => { run._resolveCompletion = resolve; });
      this.consumeRunnerStream(run, runner, promptContent, images).catch(err => {
        console.error(`${LOG_PREFIX} Runner stream error for ${sessionId}:`, err);
      }).finally(() => { run._resolveCompletion?.(); });
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
      _tokenInputs: 0,
      _tokenOutputs: 0,
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

      run._completionPromise = new Promise<void>(resolve => { run._resolveCompletion = resolve; });
      this.consumeRunnerStream(run, runner, promptContent).catch(err => {
        console.error(`${LOG_PREFIX} Runner stream error for guest ${guestSessionId}:`, err);
      }).finally(() => { run._resolveCompletion?.(); });
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

    // Wait for consumeRunnerStream → finalizeRun to complete so that
    // the session is fully persisted before we return to the caller.
    // Timeout after 8s to avoid hanging if something goes wrong.
    if (run._completionPromise) {
      const timeout = new Promise<void>(resolve => setTimeout(resolve, 8_000));
      await Promise.race([run._completionPromise, timeout]);
    }
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
    images?: ImageAttachment[],
  ): Promise<void> {
    try {
      for await (const event of runner.stream(prompt, { images })) {
        if (run.status === 'stopped') break;
        this.trackAndEmit(run, event);
      }
    } catch (err) {
      if (run.status !== 'stopped') {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.trackAndEmit(run, { type: 'error', message: errMsg });
      }
    }

    // Write a final draft snapshot before entering finalizeRun(),
    // which may take time (title generation, action processing).
    // If the server crashes during finalization, this ensures the full assistant text is recoverable.
    if (run.assistantText) {
      writeStreamingDraft(run.sessionId, run.assistantText).catch(() => {});
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
    // Release image references (no longer needed after stream completes)
    run._images = undefined;

    // Process all agent actions: parse tags, execute side-effects, strip tags
    if (run.assistantText) {
      const actionCtx = {
        sessionId: run.sessionId,
        agentId: run.agentId,
        projectKey: run.projectKey,
        emit: (event: ChatSSEEvent) => this.trackAndEmit(run, event),
        setSessionTitle: (title: string) => { if (!run.sessionTitle) run.sessionTitle = title; },
        setCheckpoint: (checkpoint: SessionCheckpoint) => { run.checkpoint = checkpoint; },
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

      // Fallback title (non-AI, sync) — satellite task will generate a better one later
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

    // When user aborts mid-stream, the SDK session may be in an inconsistent state
    // (e.g. tool call started but never completed). Clear the session ID to force
    // a fresh session on next message, avoiding resume into a broken state.
    if (aborted) {
      run.claudeSessionId = undefined;
    }

    try {
      await this.persistAfterClose(run, aborted);
    } catch (err) {
      console.error(`${LOG_PREFIX} persistAfterClose error:`, err);
    }

    // Record token usage to JSONL (fire-and-forget)
    if (!run._ephemeral && (run._tokenInputs > 0 || run._tokenOutputs > 0)) {
      appendUsageRecord({
        ts: new Date().toISOString(),
        sessionId: run.sessionId,
        agentId: run.agentId,
        projectKey: run.projectKey,
        model: run.config?.model,
        inputTokens: run._tokenInputs,
        outputTokens: run._tokenOutputs,
        contextWindow: run._contextWindow,
      }).catch((err) => {
        console.error(`${LOG_PREFIX} Failed to record token usage:`, err);
      });
    }

    // Update agent status (fire-and-forget)
    {
      const errorEvent = run.status === 'failed'
        ? run.events.find((e): e is { type: 'error'; message: string } => e.type === 'error')
        : undefined;
      updateAgentStatus(run.agentId, {
        state: run.status === 'failed' ? 'error' : 'idle',
        lastActiveAt: new Date().toISOString(),
        lastSessionId: run.sessionId,
        ...(errorEvent ? { lastError: errorEvent.message.slice(0, 200) } : {}),
      }).catch(() => {});
    }

    this.trackAndEmit(run, { type: 'done' });

    // Fire-and-forget: run all registered satellite tasks (title, health guard, task card, etc.)
    // The scheduler emits 'stream_end' after all tasks complete, which is the signal that
    // closes the SSE connection. This allows satellite SSE events (e.g. task_card_updated)
    // to reach the frontend before the connection closes.
    if (!run._ephemeral) {
      this.runSatelliteTasks(run).catch((err) => {
        console.error(`${LOG_PREFIX} Satellite tasks error:`, err);
      });
    } else {
      // Ephemeral runs skip satellite tasks — emit stream_end immediately so the SSE closes.
      this.trackAndEmit(run, { type: 'stream_end' });
    }
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

      // Throttled streaming draft write for crash recovery.
      // If the server dies mid-stream, loadSession() will recover partial text from the draft file.
      const now = Date.now();
      if (!run._lastDraftWriteTs || now - run._lastDraftWriteTs >= STREAMING_DRAFT_INTERVAL_MS) {
        run._lastDraftWriteTs = now;
        writeStreamingDraft(run.sessionId, run.assistantText).catch(() => {});
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
    } else if (event.type === 'token_usage') {
      // Track token usage on the run object for persistence
      if (event.final) {
        // Result event: cumulative total, replace directly
        if (event.inputTokens > 0) run._tokenInputs = event.inputTokens;
        if (event.outputTokens > 0) run._tokenOutputs = event.outputTokens;
      } else {
        // Streaming incremental: input overwrites, output accumulates
        if (event.inputTokens > 0) run._tokenInputs = event.inputTokens;
        if (event.outputTokens > 0) run._tokenOutputs += event.outputTokens;
      }
      if (event.contextWindow && event.contextWindow > 0) {
        run._contextWindow = event.contextWindow;
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
      checkpoint: run.checkpoint,
    };
    await persistSessionToDisk(session);
  }

  /**
   * Build a SatelliteContext and run all registered satellite tasks.
   * Called fire-and-forget after emit 'done'.
   */
  private async runSatelliteTasks(run: AgentChatRun): Promise<void> {
    const ctx: SatelliteContext = {
      sessionId: run.sessionId,
      agentId: run.agentId,
      projectKey: run.projectKey,
      messages: run.messages.map(m => ({ role: m.role, content: m.content })),
      assistantText: run.assistantText,
      assistantTurnCount: run.messages.filter(m => m.role === 'assistant').length,
      runStatus: run.status as RunStatus,
      guardRetryCount: run._guardRetryCount ?? 0,
      sessionTitle: run.sessionTitle,

      emit: (event: ChatSSEEvent) => this.trackAndEmit(run, event),

      setSessionTitle: (title: string) => {
        run.sessionTitle = title;
        this.trackAndEmit(run, { type: 'session_title_set', title });
        // Re-persist updated title to disk (fire-and-forget)
        persistSessionToDisk({
          id: run.sessionId,
          agentId: run.agentId,
          projectKey: run.projectKey,
          title,
          messages: run.messages,
          claudeSessionId: run.claudeSessionId,
          createdAt: new Date(run.startedAt).toISOString(),
          updatedAt: new Date().toISOString(),
          config: run.config,
          guardRetryCount: run._guardRetryCount,
          parentSessionId: run.parentSessionId,
          importedTurnIndices: run.importedTurnIndices,
          checkpoint: run.checkpoint,
        }).catch(() => {});
      },

      resumeSession: (message: string) => {
        // Defer until after all satellite tasks complete
        setTimeout(async () => {
          try {
            const memRun = this.runs.get(run.sessionId);
            // Race condition: user may have already started a new message
            if (memRun?.status === 'running') {
              console.log(`${LOG_PREFIX} Session ${run.sessionId} already running (user retried), skip resume`);
              return;
            }
            if (memRun) {
              memRun._guardRetryCount = (memRun._guardRetryCount ?? 0) + 1;
            }
            await incrementGuardRetryCountOnDisk(run.sessionId);

            await this.start(run.sessionId, run.agentId, message);
            console.log(`${LOG_PREFIX} Satellite task resumed session ${run.sessionId}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('already running')) {
              console.log(`${LOG_PREFIX} Session ${run.sessionId} already running (race), skip resume`);
            } else {
              console.error(`${LOG_PREFIX} Satellite resume failed:`, err);
            }
          }
        }, 0);
      },
    };

    await runSatelliteTasks(ctx);
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
      _tokenInputs: 0,
      _tokenOutputs: 0,
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

  // Inject prompt blocks referenced by agent.promptRefs
  if (agent.promptRefs?.length) {
    for (const blockId of agent.promptRefs) {
      merged.push({ type: 'prompt-block', id: blockId, priority: 3 });
    }
  }

  // Load context index (hoisted — needed by both auto-inject and code cards)
  const ctxIndex = projectKey
    ? await readJsonFile<ContextIndexData>(getContextIndexPath(), { entries: [] })
    : { entries: [] };

  // Auto-inject project-level contexts (skip when agent uses 'exclusive' strategy)
  if (projectKey && agent.contextStrategy !== 'exclusive') {
    const existingCtxIds = new Set([
      ...(baseRefs.filter(r => r.type === 'context').map(r => r.id)),
      ...(sessionConfig?.contextIds ?? []),
    ]);
    const agentTags = agent.contextTags;
    for (const entry of ctxIndex.entries) {
      if (entry.projectKey !== projectKey) continue;
      if (entry.status && entry.status !== 'active') continue;
      if (existingCtxIds.has(entry.id)) continue;
      if (agentTags?.length && (!entry.tags?.length || !entry.tags.some(t => agentTags.includes(t)))) continue;
      merged.push({ type: 'context', id: entry.id, priority: 32, injectMode: 'summary' });
    }
  }

  // ── Auto-inject Code Cards matching active task scope ──
  {
    const allCodeCards = ctxIndex.entries.filter(
      e => e.coveredPaths?.length &&
        e.tags?.includes('code-card') &&
        (!e.status || e.status === 'active'),
    );

    if (allCodeCards.length > 0) {
      // Try to find active task scope for this session
      let scopePaths: string[] = [];
      if (sessionId) {
        try {
          const runningTasks = await listRunningTasks();
          const myTask = runningTasks.find(t => t.sessionId === sessionId);
          if (myTask?.scope?.length) {
            scopePaths = myTask.scope;
          }
        } catch { /* active-tasks may not exist yet */ }
      }

      const matched = scopePaths.length > 0
        ? matchCodeCards(scopePaths, ctxIndex.entries)
        : [];

      if (matched.length > 0) {
        // Scope matched → inject full content at high priority
        for (const card of matched) {
          merged.push({ type: 'context', id: card.id, priority: 15, injectMode: 'full' });
        }
      } else {
        // No scope match (cold start or unrelated task) → inject index table
        const indexTable = buildCodeCardIndex(allCodeCards, getContextDir());
        if (indexTable) {
          const indexRef: InlineTextRef = {
            type: 'inline-text',
            id: '_code-card-index',
            priority: 40,
            label: 'Code Cards 索引',
            inlineContent: indexTable,
          };
          merged.push(indexRef);
        }
      }

      // Append update reminder (low priority, always present when code cards exist)
      const reminderRef: InlineTextRef = {
        type: 'inline-text',
        id: '_code-card-update-reminder',
        priority: 90,
        label: 'Code Card 维护提醒',
        inlineContent: '任务完成后，如果你修改了 Code Card 覆盖范围内的文件（新增函数、改变数据流、修复重要 bug），请更新对应的 Code Card 内容，保持代码理解层的准确性。使用 PATCH /api/context/[id] 更新内容。',
      };
      merged.push(reminderRef);
    }
  }

  if (extraRefs) merged.push(...extraRefs);

  // ── Phase 2: Merge contextRefs from active todos assigned to this agent ──
  {
    const todosData = await readJsonFile<TodosData>(getTodosPath(), { todos: [] });
    const activeTodos = todosData.todos.filter(t =>
      t.status === 'in_progress' &&
      t.agentId === agent.id &&
      t.contextRefs?.length,
    );
    for (const todo of activeTodos) {
      for (const ref of todo.contextRefs!) {
        merged.push({ ...ref, priority: ref.priority ?? 33 });
      }
    }
  }

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
    // Phase 4: unified resourceRefs take precedence over legacy contextIds/skillNames
    if (sessionConfig.resourceRefs?.length) {
      merged.push(...sessionConfig.resourceRefs);
    }
    // Legacy fields still work (backward compatible)
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

async function buildAgentChatPrompt(agent: Agent, message: string, sessionConfig?: SessionConfig, sessionId?: string, projectKey?: string, conversationHistory?: string): Promise<string> {
  const resourcePrompt = await buildResourcePrompt(agent, undefined, sessionConfig, sessionId, projectKey);

  const historyBlock = conversationHistory ? `\n${conversationHistory}\n` : '';

  return `${resourcePrompt}
${historyBlock}
---

用户消息：${message}`;
}

async function buildAgentChatPromptWithFlowContext(
  agent: Agent,
  message: string,
  flowContext: FlowContext,
  sessionConfig?: SessionConfig,
  sessionId?: string,
  conversationHistory?: string,
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

  const historyBlock = conversationHistory ? `\n${conversationHistory}\n` : '';

  return `${resourcePrompt}
${historyBlock}
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
