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
import { getPromptFilePath, getContextIndexPath, readJsonFile } from '@/lib/file-store';
import type { ContextIndexData } from '@/types';
import { resolveSystemPrompt, createRuntimePromptCopy } from '@/lib/agent-prompt-store';
import { getSettings } from '@/lib/settings-manager';
import { createAgentRunner, type AgentRunnerInput, type IAgentRunner } from './agent-runner';
import { detectDangerousCommand } from '@/lib/danger-detector';
import type { ChatSSEEvent, ContentBlock, Agent, AgentCapabilities, ProviderId } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES, DEFAULT_DANGER_SETTINGS } from '@/types';
import type { AgentChatSession, SessionConfig } from '@/types/agent-chat';
import type { ResourceRef, InlineTextRef, FlowContextRef, ReferenceTurnsRef } from '@/types/resource';
import { resourceRegistry } from '@/lib/resource-registry';
import '@/lib/resource-loaders'; // side-effect: registers non-action loaders
import '@/lib/agent-actions';    // side-effect: registers actions + their loaders
import { actionRegistry } from '@/lib/agent-actions';
import { migrateAgentToResources } from '@/lib/resource-migration';
import type { SystemPromptLoaderContext } from '@/lib/resource-loaders/system-prompt-loader';
import '@/lib/satellite-tasks';  // side-effect: registers satellite tasks
import { runSatelliteTasks } from '@/lib/satellite-tasks';
import type { SatelliteContext } from '@/lib/satellite-tasks';
import type { RunStatus, RunStatusInfo, SubAgentResult, SessionExecution } from './types';
import {
  cleanupTempImageFiles,
  imageAttachmentToDataUrl,
  writeImageAttachmentsToTempFiles,
} from '@/lib/image-assets';
import { serializeProviderInput } from '@/lib/image-provider-serialization';
import type { ImageAttachment, ImageMediaType } from '@/lib/image-assets';

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
} from './agent-chat-session-store';

// ── Types ──

export type { ImageAttachment, ImageMediaType } from '@/lib/image-assets';

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
  /** 用户主动触发的停止（区别于意外中止），不触发 Health Guard 自动恢复 */
  _userStopped?: boolean;

  /** 流式草稿防抖：上次刷盘时 assistantText 的长度 */
  _draftFlushedLen?: number;
  /** 流式草稿防抖：上次刷盘的时间戳（ms） */
  _draftFlushAt?: number;

  /** Sub Agent 调用深度（0=顶层，服务端自动追踪） */
  depth?: number;
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
    depth?: number,
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

    if (existing?.status === 'running' || existing?.status === 'finalizing') {
      throw new Error('This session is already running');
    }

    const messages = existing?.messages ? [...existing.messages] : [];
    const dataUrls = images?.map(imageAttachmentToDataUrl);
    messages.push({ role: 'user', content: message, images: dataUrls?.length ? dataUrls : undefined });

    // History turns for prompt injection (all messages before the current user message)
    const historyTurns: Array<{ role: 'user' | 'assistant'; content: string }> = existing?.messages
      ? existing.messages.map(m => ({ role: m.role, content: m.content }))
      : [];

    const sessionConfig = initialConfig ?? existing?.config;

    // ── Resolve provider with priority chain ──
    const resolvedProvider = providerOverride
      || sessionConfig?.provider
      || agent.defaultProvider
      || undefined;

    // ── Detect provider switch → invalidate SDK session ID & model ──
    const previousProvider = existing?.config?.provider;
    const providerSwitched = !!previousProvider && !!resolvedProvider && previousProvider !== resolvedProvider;
    const isResume = !!existing?.claudeSessionId && !providerSwitched;

    // ── Resolve model — skip session config model when provider switched ──
    // When switching providers (e.g. OpenAI → Anthropic), the old session's model
    // (e.g. 'gpt-5.4') is incompatible with the new provider's SDK.
    // In that case, fall through to agent default or let the SDK resolve via settings.
    const resolvedModel = modelOverride
      || (!providerSwitched ? sessionConfig?.model : undefined)
      || agent.defaultModel
      || undefined;

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

    if (providerSwitched) {
      console.log(`${LOG_PREFIX} Provider switched from ${previousProvider} to ${resolvedProvider} — will NOT resume SDK session, history injected via prompt, model=${resolvedModel ?? '(default)'}`);
    }

    // Build prompt
    const sessionProjectKey = flowContext?.projectKey ?? existing?.projectKey;

    let promptContent: string;
    if (flowContext) {
      promptContent = await buildAgentChatPromptWithFlowContext(agent, message, flowContext, persistedConfig, sessionId, historyTurns);
    } else {
      promptContent = await buildAgentChatPrompt(agent, message, persistedConfig, sessionId, sessionProjectKey, historyTurns);
    }

    const tempPaths = await writeImageAttachmentsToTempFiles(images);
    const runnerInput = serializeProviderInput({
      provider: resolvedProvider ?? 'anthropic',
      prompt: promptContent,
      sessionId,
      images,
      imagePaths: tempPaths,
    });

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
        claudeSessionId: existing?.claudeSessionId,
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
      claudeSessionId: existing?.claudeSessionId,
      messages,
      config: persistedConfig,
      parentSessionId: parentSessionId ?? existing?.parentSessionId,
      _tempImagePaths: tempPaths,
      _guardRetryCount: existing?._guardRetryCount,
      _ephemeral: ephemeral,
      depth,
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
        resumeSessionId: isResume ? existing?.claudeSessionId : undefined,
        cwd: getAppWorkingDir(),
      });
      run.runner = runner;

      this.consumeRunnerStream(run, runner, runnerInput).catch(err => {
        console.error(`${LOG_PREFIX} Runner stream error for ${sessionId}:`, err);
      });
    } catch (err) {
      this.trackAndEmit(run, { type: 'error', message: `Failed to start runner: ${err instanceof Error ? err.message : String(err)}` });
      run.status = 'failed';
      run.completedAt = Date.now();
      run.runner = null;
      await this.persistAfterClose(run, false, 'failed');
      this.trackAndEmit(run, { type: 'done' });
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

    if (run.status !== 'running' && run.status !== 'finalizing') {
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
    // `finalizing` is an internal state — external callers see it as `running`
    // because the result is not yet safe to read from disk.
    const externalStatus = run.status === 'finalizing' ? 'running' : run.status;
    return {
      status: externalStatus,
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
    run._userStopped = true; // 标记为用户主动停止，Health Guard 不自动恢复
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
    if (run?.status === 'running' || run?.status === 'finalizing') return;
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
    input: AgentRunnerInput,
  ): Promise<void> {
    try {
      for await (const event of runner.stream(input)) {
        if (run.status === 'stopped') break;
        this.trackAndEmit(run, event);
      }
    } catch (err) {
      if (run.status !== 'stopped') {
        const errMsg = err instanceof Error ? err.message : String(err);
        const errStack = err instanceof Error ? err.stack : undefined;
        console.error(`${LOG_PREFIX} consumeRunnerStream error for session=${run.sessionId} agent=${run.agentId}:`, errMsg);
        if (errStack) console.error(`${LOG_PREFIX} Stack:`, errStack);
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
    await cleanupTempImageFiles(run._tempImagePaths);

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
    }

    // Transition to `finalizing` — stream ended but persistence not yet done.
    // This eliminates the "completed but not persisted" race window.
    const terminalStatus: RunStatus = aborted ? 'stopped' : 'completed';
    if (run.status === 'running') {
      run.status = 'finalizing';
    }
    run.completedAt = Date.now();

    // ── Run satellite tasks (title generation, health guard, etc.) ──
    const assistantTurnCount = run.messages.filter(m => m.role === 'assistant').length;
    const satelliteCtx: SatelliteContext = {
      sessionId: run.sessionId,
      agentId: run.agentId,
      projectKey: run.projectKey,
      messages: run.messages.map(m => ({ role: m.role, content: m.content })),
      assistantText: run.assistantText,
      assistantTurnCount,
      sessionTitle: run.sessionTitle,
      runStatus: terminalStatus,
      userStopped: run._userStopped,
      guardRetryCount: run._guardRetryCount ?? 0,
      emit: (event: ChatSSEEvent) => this.trackAndEmit(run, event),
      setSessionTitle: (title: string) => { run.sessionTitle = title; },
      resumeSession: async (message: string) => {
        // Increment guard retry count
        run._guardRetryCount = (run._guardRetryCount ?? 0) + 1;
        await incrementGuardRetryCountOnDisk(run.sessionId);
        // Schedule resume after current finalization completes
        setTimeout(async () => {
          const memRun = this.runs.get(run.sessionId);
          if (memRun?.status === 'running') {
            console.log(`${LOG_PREFIX} Session ${run.sessionId} already running, skip resume`);
            return;
          }
          try {
            await this.start(run.sessionId, run.agentId, message);
            console.log(`${LOG_PREFIX} Health guard resumed session ${run.sessionId}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('already running')) {
              console.log(`${LOG_PREFIX} Session ${run.sessionId} already running (race), skip resume`);
            } else {
              console.error(`${LOG_PREFIX} Health guard failed to resume session:`, err);
            }
          }
        }, 0);
      },
    };

    try {
      await runSatelliteTasks(satelliteCtx);
    } catch (err) {
      console.error(`${LOG_PREFIX} Satellite tasks error:`, err);
    }

    // Apply title fallback if no satellite task set a title
    if (!run.sessionTitle) {
      const firstUserMsg = run.messages.find(m => m.role === 'user')?.content;
      const defaultTitle = run.parentSessionId ? '旁听会话' : '新会话';
      run.sessionTitle = firstUserMsg ? firstUserMsg.slice(0, 30) + '...' : defaultTitle;
    }
    this.trackAndEmit(run, { type: 'session_title_set', title: run.sessionTitle });

    try {
      await this.persistAfterClose(run, aborted, terminalStatus);
    } catch (err) {
      console.error(`${LOG_PREFIX} persistAfterClose error:`, err);
    }

    // Only NOW set the terminal status — guarantees data is on disk when
    // callers see `completed`. This eliminates the state/persistence split.
    run.status = terminalStatus;

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

      // Streaming draft flush (crash recovery).
      // Write accumulated text to a sidecar .streaming.json file so that if the
      // process crashes before finalizeRun() we can recover the partial reply.
      // Conditions: non-ephemeral session, and either ≥500 new chars or ≥2s elapsed.
      if (!run._ephemeral) {
        const now = Date.now();
        const charsSinceLast = run.assistantText.length - (run._draftFlushedLen ?? 0);
        const msSinceLast = now - (run._draftFlushAt ?? 0);
        if (charsSinceLast >= 500 || msSinceLast >= 2000) {
          run._draftFlushedLen = run.assistantText.length;
          run._draftFlushAt = now;
          // Fire-and-forget: do not await, never block the streaming event loop
          writeStreamingDraft(run.sessionId, run.assistantText).catch(() => {});
        }
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

  private async persistAfterClose(
    run: AgentChatRun,
    _aborted: boolean,
    terminalStatus: RunStatus,
  ): Promise<void> {
    if (run._ephemeral) return;

    const now = new Date().toISOString();

    // Build execution record — the single source of truth for run outcome
    const execution: SessionExecution = {
      status: terminalStatus as 'completed' | 'failed' | 'stopped',
      startedAt: new Date(run.startedAt).toISOString(),
      completedAt: now,
    };

    // Build structured result for sub-agent callers (行动项 3)
    if (run.parentSessionId) {
      const lastAssistant = [...run.messages].reverse().find(m => m.role === 'assistant');
      const summary = lastAssistant
        ? lastAssistant.content.slice(0, 500)
        : (terminalStatus === 'completed' ? '(no output)' : '');
      const result: SubAgentResult = {
        status: terminalStatus as SubAgentResult['status'],
        summary,
      };
      if (terminalStatus !== 'completed') {
        const lastError = run.events
          .filter((e): e is { type: 'error'; message: string } => e.type === 'error' && 'message' in e)
          .pop();
        result.error = {
          code: terminalStatus,
          message: lastError?.message ?? `Run ${terminalStatus}`,
        };
      }
      execution.result = result;
    }

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
      depth: run.depth,
    };
    await persistSessionToDisk(session, execution);
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
        run.status !== 'finalizing' &&
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

async function buildAgentChatPrompt(
  agent: Agent,
  message: string,
  sessionConfig?: SessionConfig,
  sessionId?: string,
  projectKey?: string,
  historyTurns?: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<string> {
  const extraRefs: ResourceRef[] = [];

  if (historyTurns && historyTurns.length > 0) {
    const turnsRef: ReferenceTurnsRef = {
      type: 'reference-turns',
      id: '_history',
      priority: 60,
      label: '对话历史',
      turns: historyTurns,
    };
    extraRefs.push(turnsRef);
  }

  const resourcePrompt = await buildResourcePrompt(agent, extraRefs.length > 0 ? extraRefs : undefined, sessionConfig, sessionId, projectKey);

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
  historyTurns?: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<string> {
  const { projectKey, projectName, flowDataPath } = flowContext;

  const extraRefs: ResourceRef[] = [];

  const flowRef: FlowContextRef = {
    type: 'flow-context',
    id: '_snapshot',
    priority: 70,
    label: '项目上下文',
    projectKey,
    projectName,
    flowDataPath,
  };
  extraRefs.push(flowRef);

  if (historyTurns && historyTurns.length > 0) {
    const turnsRef: ReferenceTurnsRef = {
      type: 'reference-turns',
      id: '_history',
      priority: 60,
      label: '对话历史',
      turns: historyTurns,
    };
    extraRefs.push(turnsRef);
  }

  const resourcePrompt = await buildResourcePrompt(agent, extraRefs, sessionConfig, sessionId, projectKey);

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
    // 粗略估算：英文 ~4 chars/token，中文 ~1.5 chars/token，取 3.5 折中
    estimatedTokens: Math.ceil(promptText.length / 3.5),
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
