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

import path from 'path';
import { promises as fs } from 'fs';
import { getAppWorkingDir } from '@/lib/app-paths';
import { getPromptFilePath, getDocumentsContentDir, readJsonFile, readProjectIndex } from '@/lib/file-store';
import { readDocsIndexFromDocuments } from '@/lib/documents-store';
import { isValidWorkingDir } from '@/lib/security-validation';
import { readTodosMerged } from '@/lib/todo-file-store';
import { matchCodeCards, buildCodeCardIndex } from '@/lib/code-card-matcher';
import { listRunningTasks } from '@/lib/active-tasks';
import { resolveSystemPrompt, createRuntimePromptCopy } from '@/lib/agent-prompt-store';
import { resolveSkillsForSession } from '@/lib/skill-store';
import { getSettings } from '@/lib/settings-manager';
import { createAgentRunner, type IAgentRunner } from './agent-runner';
import { detectDangerousCommand } from '@/lib/danger-detector';
import type { AgentEvent, ContentBlock, Agent, AgentCapabilities, ProviderId } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES, DEFAULT_DANGER_SETTINGS } from '@/types';
import type { AgentChatSession, SessionConfig, SessionCheckpoint, SessionSourceType } from '@/types/agent-chat';
import type { ResourceRef, InlineTextRef, FlowContextRef, ReferenceTurnsRef } from '@/types/resource';
import { resourceRegistry } from '@/lib/resource-registry';
import { formatConversationHistory } from './conversation-history';
import '@/lib/resource-loaders'; // side-effect: registers non-action loaders
import '@/lib/agent-actions';    // side-effect: registers actions + their loaders
import { actionRegistry } from '@/lib/agent-actions';
import { estimateTokens } from '@/lib/token-estimate';
import { buildSystemLevelPrompt } from '@/lib/system-level-prompt';
import { CALLABLE_AGENTS_RESOURCE_REF, migrateAgentToResources } from '@/lib/resource-migration';
import { updateAgentStatus } from '@/lib/agents-store';
import type { SystemPromptLoaderContext } from '@/lib/resource-loaders/system-prompt-loader';
import { repairStoredTextIfNeeded } from '@/lib/text-repair-server';
import { PROMPT_PRIORITY } from '@/lib/prompt-priorities';
import { normalizePathsForPromptGlobs } from '@/lib/prompt-rule-files';
import type { RunStatus, RunStatusInfo, SessionExecution } from './types';
import { appendUsageRecord } from '@/lib/usage-store';
import { normalizeOpenAIFastMode } from '@/lib/openai-fast-mode';
import { normalizeOpenAIReasoningEffort } from '@/lib/openai-reasoning-effort';
import { hasToolCallWithId } from '@/lib/agent-tool-call-dedupe';

import {
  reduceAndPersistTurnEvents,
  getActiveRun,
  openRun,
  closeRun,
  type TurnData,
} from '@/lib/execution-event-store';

// Re-export store functions so existing callers don't break during migration
export { generateSessionId } from './agent-chat-session-store';

// Import store functions for internal use
import {
  loadSession,
  loadAgent,
  eagerlySaveUserTurn,
  persistSessionToDisk,
  deleteSessionFromDisk,
  updateConfigOnDisk,
  writeStreamingDraft,
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
  /** 本地项目根目录（projects/index.json 的 path；可为独立 git worktree 路径） */
  projectRoot?: string;
  /** @deprecated 已无服务端 flow 文件 */
  flowDataPath?: string;
}

/**
 * Agent 工具与 SDK 的工作目录：优先项目登记路径（含用户配置的 worktree），避免误用后端 process.cwd()。
 */
async function resolveAgentChatCwd(
  flowContext: FlowContext | undefined,
  projectKey: string | undefined,
): Promise<string> {
  async function tryDir(raw: string | undefined | null): Promise<string | null> {
    if (!raw || typeof raw !== 'string') return null;
    const resolved = path.normalize(path.resolve(raw.trim()));
    if (!isValidWorkingDir(resolved)) return null;
    try {
      const st = await fs.stat(resolved);
      return st.isDirectory() ? resolved : null;
    } catch {
      return null;
    }
  }

  const fromFlow = await tryDir(flowContext?.projectRoot);
  if (fromFlow) return fromFlow;

  const pk = flowContext?.projectKey ?? projectKey;
  if (pk) {
    try {
      const index = await readProjectIndex();
      const found = index.projects.find((p) => p.key === pk);
      const fromIndex = await tryDir(found?.path);
      if (fromIndex) return fromIndex;
    } catch {
      /* ignore */
    }
  }

  return getAppWorkingDir();
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
  sourceType?: SessionSourceType;
  sourceId?: string;
  todoId?: string;

  /** 当前运行的 SDK runner（统一 Claude Agent SDK / Codex SDK 抽象） */
  runner: IAgentRunner | null;

  // Run lifecycle
  status: RunStatus;
  startedAt: number;
  completedAt?: number;

  // Event streaming
  events: AgentEvent[];
  listeners: Set<(event: AgentEvent, index: number) => void>;

  // Accumulation
  assistantText: string;
  contentBlocks: ContentBlock[];
  toolCalls: ChatToolCall[];

  // Resume support
  claudeSessionId?: string;

  // Danger detector settings snapshot
  dangerSettings?: import('@/types').DangerDetectorSettings;

  // Session data
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    images?: string[];
    contentBlocks?: ContentBlock[];
    meta?: import('@/types/agent-chat').ChatMessageDiskMeta;
  }>;
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
  _awaitingSubAgents?: SessionExecution['awaiting'];

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
    fastModeOverride?: boolean,
    ephemeral?: boolean,
    _depth?: number,
    _background?: boolean,
    sourceType?: SessionSourceType,
    sourceId?: string,
    todoId?: string,
    userMessageMeta?: import('@/types/agent-chat').ChatMessageDiskMeta,
    /** 不在磁盘消息末尾再追加用户气泡；以上一条用户消息为当前轮（编辑后重发） */
    reuseLastUserTurn?: boolean,
  ): Promise<string> {
    const agent = await loadAgent(agentId);
    void _depth;
    void _background;

    const existingRun = this.runs.get(sessionId);
    const diskSession = existingRun ? null : await loadSession(sessionId);

    if (existingRun?.status === 'running') {
      throw new Error('This session is already running');
    }

    const reuseTurn = reuseLastUserTurn === true;
    const existingMessages = existingRun?.messages ?? diskSession?.messages ?? [];
    const messages = [...existingMessages];
    const dataUrls = images?.map(img => `data:${img.mediaType};base64,${img.data}`);

    if (reuseTurn) {
      if (messages.length === 0 || messages[messages.length - 1]?.role !== 'user') {
        throw new Error('reuseLastUserTurn requires the session to end with a user message');
      }
    } else {
      messages.push({
        role: 'user',
        content: message,
        images: dataUrls?.length ? dataUrls : undefined,
        ...(userMessageMeta ? { meta: userMessageMeta } : {}),
      });
    }

    const sessionConfig = initialConfig ?? existingRun?.config ?? diskSession?.config;
    const existingProjectKey = existingRun?.projectKey ?? diskSession?.projectKey;
    const existingSessionTitle = existingRun?.sessionTitle ?? diskSession?.title;
    const existingParentSessionId = existingRun?.parentSessionId ?? diskSession?.parentSessionId;
    const existingClaudeSessionId = existingRun?.claudeSessionId ?? diskSession?.claudeSessionId;
    const existingCheckpoint = existingRun?.checkpoint ?? diskSession?.checkpoint;
    const existingGuardRetryCount = existingRun?._guardRetryCount ?? diskSession?.guardRetryCount;

    // ── Resolve provider / model with priority chain ──
    const resolvedProvider = providerOverride
      || sessionConfig?.provider
      || agent.defaultProvider
      || undefined;
    const resolvedModel = modelOverride
      || sessionConfig?.model
      || agent.defaultModel
      || undefined;
    const resolvedOpenAIEffort = normalizeOpenAIReasoningEffort(
      effortOverride
      || sessionConfig?.openaiReasoningEffort
      || agent.defaultOpenAIReasoningEffort,
    );
    const settings = await getSettings();
    const hasExplicitOpenAIFastMode =
      fastModeOverride !== undefined || sessionConfig?.openaiFastMode !== undefined;
    const resolvedOpenAIFastMode = normalizeOpenAIFastMode(
      fastModeOverride
      ?? sessionConfig?.openaiFastMode
      ?? settings.claude.openaiFastMode
      ?? false,
    ) ?? false;

    // 切换 provider/model 后，旧的 resume session 可能不兼容（常见于同会话切换渠道）。
    // 这种情况下必须放弃 resume，避免 Claude SDK 直接 error_during_execution / code 1。
    const prevProvider = existingRun?.config?.provider ?? diskSession?.config?.provider;
    const prevModel = existingRun?.config?.model ?? diskSession?.config?.model;
    const hasResumeId = !!existingClaudeSessionId;
    const lastRole = existingMessages[existingMessages.length - 1]?.role;
    const previousTurnIncomplete = lastRole === 'user';
    const providerChanged =
      hasResumeId && !!prevProvider && !!resolvedProvider && prevProvider !== resolvedProvider;
    const modelChanged =
      hasResumeId && !!prevModel && !!resolvedModel && prevModel !== resolvedModel;
    const isResume = hasResumeId && !providerChanged && !modelChanged && !previousTurnIncomplete;
    const resumeSessionId = isResume ? existingClaudeSessionId : undefined;

    // Persist resolved provider/model into session config
    const persistedConfig: SessionConfig = {
      ...sessionConfig,
      ...(resolvedProvider ? { provider: resolvedProvider } : {}),
      ...(resolvedModel ? { model: resolvedModel } : {}),
      ...(resolvedProvider === 'openai' && resolvedOpenAIEffort
        ? { openaiReasoningEffort: resolvedOpenAIEffort }
        : {}),
      ...(resolvedProvider === 'openai' && (hasExplicitOpenAIFastMode || resolvedOpenAIFastMode)
        ? { openaiFastMode: resolvedOpenAIFastMode }
        : {}),
    };

    // OpenAI 协议的自定义供应商暂不支持 Agent Chat（仅内置 openai 支持 Codex CLI）
    if (resolvedProvider?.startsWith('custom-')) {
      const cp = settings.claude.customProviders?.find((c) => c.id === resolvedProvider);
      if (cp?.apiProtocol === 'openai') {
        throw new Error(
          'OpenAI 协议的自定义供应商暂不支持 Agent 对话。请使用 Anthropic 协议的自定义供应商或切换至内置 OpenAI。',
        );
      }
    }

    // Build prompt
    const sessionProjectKey = flowContext?.projectKey ?? existingProjectKey;

    // 当 resume 不可用但存在历史消息时，将历史对话注入 prompt
    // 这样即使 SDK 会话是全新的，AI 也能知道之前聊过什么
    const historyMessagesForPrompt = reuseTurn
      ? (messages.length > 1 ? messages.slice(0, -1) : [])
      : existingMessages;
    const conversationHistory = (!resumeSessionId && historyMessagesForPrompt.length > 0)
      ? formatConversationHistory(historyMessagesForPrompt, existingCheckpoint ?? undefined)
      : undefined;

    if (conversationHistory && !resumeSessionId && historyMessagesForPrompt.length > 0) {
      console.log(
        `${LOG_PREFIX} [${sessionId}] Resume unavailable, injecting ${historyMessagesForPrompt.length} messages as conversation history`,
      );
    }

    const lastUserForPrompt = reuseTurn && messages.length > 0 ? messages[messages.length - 1] : null;
    let promptMessage = message;
    if (
      reuseTurn
      && !String(promptMessage ?? '').trim()
      && lastUserForPrompt?.role === 'user'
      && lastUserForPrompt.images
      && lastUserForPrompt.images.length > 0
    ) {
      promptMessage = `[用户消息包含 ${lastUserForPrompt.images.length} 张图片，无附加文字]`;
    }

    const tBuildPrompt = Date.now();
    let promptContent: string;
    if (flowContext) {
      promptContent = await buildAgentChatPromptWithFlowContext(
        agent,
        promptMessage,
        flowContext,
        persistedConfig,
        sessionId,
        conversationHistory ?? undefined,
      );
    } else {
      promptContent = await buildAgentChatPrompt(
        agent,
        promptMessage,
        persistedConfig,
        sessionId,
        sessionProjectKey,
        conversationHistory ?? undefined,
      );
    }
    console.log(
      `${LOG_PREFIX} [${sessionId}] buildPrompt done in ${Date.now() - tBuildPrompt}ms (chars=${promptContent.length})`,
    );

    // Merge capabilities
    const effectiveCaps = mergeCapabilities(agent.capabilities, persistedConfig?.capabilities);

    const eagerSavePayload = !ephemeral
      ? {
          sessionId,
          agentId,
          projectKey: flowContext?.projectKey ?? existingProjectKey,
          sessionTitle: existingSessionTitle ?? initialTitle,
          sourceType: sourceType ?? diskSession?.sourceType ?? 'manual',
          sourceId: sourceId ?? diskSession?.sourceId,
          todoId: todoId ?? diskSession?.todoId,
          messages,
          claudeSessionId: resumeSessionId,
          config: persistedConfig,
          parentSessionId: parentSessionId ?? existingParentSessionId,
          importedTurnIndices: undefined,
        }
      : null;

    // ── Create run ──
    const runId = `run-${sessionId}-${Date.now()}`;
      const run: AgentChatRun = {
        runId,
        sessionId,
        agentId,
        projectKey: flowContext?.projectKey ?? existingProjectKey,
        sessionTitle: existingSessionTitle ?? initialTitle,
        sourceType: sourceType ?? diskSession?.sourceType ?? 'manual',
        sourceId: sourceId ?? diskSession?.sourceId,
        todoId: todoId ?? diskSession?.todoId,
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
      parentSessionId: parentSessionId ?? existingParentSessionId,
      _images: images,
      _guardRetryCount: existingGuardRetryCount,
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
    console.log(`${LOG_PREFIX} [${sessionId}] runs.set (status=running, events=0)`);

    // Update agent status to busy (fire-and-forget)
    updateAgentStatus(agentId, {
      state: 'busy',
      lastActiveAt: new Date().toISOString(),
      lastSessionId: sessionId,
    }).catch(() => {});

    // ── Launch runner（provider 无关）──
    try {
      const tParallel = Date.now();
      const savePromise = eagerSavePayload
        ? eagerlySaveUserTurn(eagerSavePayload).catch((e) => {
          console.error(`${LOG_PREFIX} [${sessionId}] eagerlySaveUserTurn failed:`, e);
          throw e;
        })
        : Promise.resolve();

      const runnerPromise = (async () => {
        const cwd = await resolveAgentChatCwd(flowContext, sessionProjectKey);
        console.log(`${LOG_PREFIX} [${sessionId}] Creating runner: provider=${resolvedProvider ?? 'anthropic'} model=${resolvedModel} cwd=${cwd} resumeSessionId=${resumeSessionId ?? 'none'} promptLen=${promptContent.length}`);
        return createAgentRunner({
          provider: resolvedProvider ?? 'anthropic',
          capabilities: effectiveCaps,
          model: resolvedModel,
          effortOverride: resolvedOpenAIEffort,
          fastModeOverride: resolvedOpenAIFastMode,
          resumeSessionId,
          cwd,
          systemLevelInput: {
            agentId,
            capabilities: effectiveCaps,
            projectKey: sessionProjectKey,
            model: resolvedModel,
            provider: resolvedProvider ?? 'anthropic',
          },
        });
      })();

      const [, runner] = await Promise.all([savePromise, runnerPromise]);
      console.log(
        `${LOG_PREFIX} [${sessionId}] parallel save+runner done in ${Date.now() - tParallel}ms, spawning consumeRunnerStream`,
      );
      run.runner = runner;

      run._completionPromise = new Promise<void>(resolve => { run._resolveCompletion = resolve; });
      this.consumeRunnerStream(run, runner, promptContent, images).catch(err => {
        console.error(`${LOG_PREFIX} Runner stream error for ${sessionId}:`, err);
      }).finally(() => { run._resolveCompletion?.(); });
    } catch (err) {
      this.trackAndEmit(run, { type: 'error', message: `Failed to start runner: ${err instanceof Error ? err.message : String(err)}` });
      this.trackAndEmit(run, { type: 'done' });
      this.trackAndEmit(run, { type: 'stream_end' });
      run.status = 'failed';
      run.completedAt = Date.now();
      run.runner = null;
      await this.persistAfterClose(run, false);
    }

    console.log(`${LOG_PREFIX} [${sessionId}] start() return runId=${run.runId} (POST may now respond)`);
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

    const existingRun = this.runs.get(guestSessionId);
    const diskSession = existingRun ? null : await loadSession(guestSessionId);
    if (existingRun?.status === 'running') {
      throw new Error('This guest session is already running');
    }

    const existingMessages = existingRun?.messages ?? diskSession?.messages ?? [];
    const isResume = !!(existingRun?.claudeSessionId ?? diskSession?.claudeSessionId);
    const messages = [...existingMessages];
    messages.push({ role: 'user', content: message });

    // ── Resolve provider — host session config → agent default → anthropic ──
    const resolvedProvider: ProviderId =
      hostSession.config?.provider
      ?? agent.defaultProvider
      ?? 'anthropic';

    const promptContent = await buildGuestAgentPrompt(agent, message, selectedTurns, diskSession?.config);

    // Create run
    const runId = `run-${guestSessionId}-${Date.now()}`;
    const run: AgentChatRun = {
      runId,
      sessionId: guestSessionId,
      agentId,
      projectKey: diskSession?.projectKey ?? hostSession.projectKey,
      sessionTitle: existingRun?.sessionTitle ?? diskSession?.title,
      runner: null,
      status: 'running',
      startedAt: Date.now(),
      events: [],
      listeners: new Set(),
      assistantText: '',
      contentBlocks: [],
      toolCalls: [],
      claudeSessionId: existingRun?.claudeSessionId ?? diskSession?.claudeSessionId,
      messages,
      parentSessionId,
      importedTurnIndices: turnIndices,
      checkpoint: diskSession?.checkpoint,
      config: diskSession?.config,
      _guardRetryCount: diskSession?.guardRetryCount,
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
    const guestProjectKey = diskSession?.projectKey ?? hostSession.projectKey;
    const cwd = await resolveAgentChatCwd(undefined, guestProjectKey);
    const guestCaps = mergeCapabilities(agent.capabilities, diskSession?.config?.capabilities);
      const runner = await createAgentRunner({
        provider: resolvedProvider,
        capabilities: guestCaps,
        model: agent.defaultModel,
        resumeSessionId: isResume ? (existingRun?.claudeSessionId ?? diskSession?.claudeSessionId) : undefined,
        cwd,
        systemLevelInput: {
          agentId,
          capabilities: guestCaps,
          projectKey: guestProjectKey,
          model: agent.defaultModel,
          provider: resolvedProvider,
        },
      });
      run.runner = runner;

      run._completionPromise = new Promise<void>(resolve => { run._resolveCompletion = resolve; });
      this.consumeRunnerStream(run, runner, promptContent).catch(err => {
        console.error(`${LOG_PREFIX} Runner stream error for guest ${guestSessionId}:`, err);
      }).finally(() => { run._resolveCompletion?.(); });
    } catch (err) {
      this.trackAndEmit(run, { type: 'error', message: `Failed to start runner: ${err instanceof Error ? err.message : String(err)}` });
      this.trackAndEmit(run, { type: 'done' });
      this.trackAndEmit(run, { type: 'stream_end' });
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
    listener: (event: AgentEvent, index: number) => void,
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

  getRuntimeSnapshot(sessionId: string): {
    status: RunStatus;
    runId: string;
    startedAt: string;
    eventCount: number;
    errorMessage?: string;
    messages: Array<{
      role: 'user' | 'assistant';
      content: string;
      images?: string[];
      contentBlocks?: ContentBlock[];
    }>;
  } | null {
    const run = this.runs.get(sessionId);
    if (!run) return null;
    const lastError = run.events.filter((e): e is { type: 'error'; message: string } =>
      e.type === 'error' && 'message' in e
    ).pop();
    return {
      status: run.status,
      runId: run.runId,
      startedAt: new Date(run.startedAt).toISOString(),
      eventCount: run.events.length,
      errorMessage: lastError?.message,
      messages: run.messages.map(message => ({ ...message })),
    };
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
    const consumeT0 = Date.now();
    console.log(
      `${LOG_PREFIX} [${run.sessionId}] consumeRunnerStream start promptLen=${prompt.length}`
      + ` — next: await first chunk from runner.stream()`,
    );

    const firstEventTimer = setTimeout(() => {
      console.warn(
        `${LOG_PREFIX} [${run.sessionId}] ⚠ No runner events after 30s — Claude SDK 首轮无输出：`
        + ' 可能是上游 API（含 DeepSeek 等 Anthropic 兼容端）过慢/卡住、网络问题，或与 Agent SDK 不完全兼容。',
      );
    }, 30000);

    try {
      let eventCount = 0;
      for await (const event of runner.stream(prompt, {
        images,
        observability: {
          sessionId: run.sessionId,
          agentId: run.agentId,
          runId: run.runId,
        },
      })) {
        if (eventCount === 0) {
          clearTimeout(firstEventTimer);
          console.log(
            `${LOG_PREFIX} [${run.sessionId}] first runner event after ${Date.now() - consumeT0}ms type=${event.type}`,
          );
        }
        if (run.status === 'stopped') break;
        eventCount++;
        if (eventCount <= 5 || event.type === 'error' || event.type === 'done') {
          console.log(`${LOG_PREFIX} [${run.sessionId}] runner event #${eventCount}: type=${event.type}`);
        }
        this.trackAndEmit(run, event);
      }
      clearTimeout(firstEventTimer);
      console.log(`${LOG_PREFIX} [${run.sessionId}] runner stream ended, total events: ${eventCount}`);
    } catch (err) {
      console.error(`${LOG_PREFIX} [${run.sessionId}] runner stream threw:`, err);
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
      const actionCtx: {
        sessionId: string;
        agentId: string;
        projectKey?: string;
        emit: (event: AgentEvent) => void;
        setSessionTitle: (title: string) => void;
        setCheckpoint: (checkpoint: SessionCheckpoint) => void;
        _awaitingSubAgents?: SessionExecution['awaiting'];
      } = {
        sessionId: run.sessionId,
        agentId: run.agentId,
        projectKey: run.projectKey,
        emit: (event: AgentEvent) => this.trackAndEmit(run, event),
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

      // Fallback title (non-AI, sync)
      if (!run.sessionTitle) {
        const firstUserMsg = run.messages.find(m => m.role === 'user')?.content;
        const defaultTitle = run.parentSessionId ? '旁听会话' : '新会话';
        run.sessionTitle = firstUserMsg ? firstUserMsg.slice(0, 30) + '...' : defaultTitle;
      }

      this.trackAndEmit(run, { type: 'session_title_set', title: run.sessionTitle });

      if (actionCtx._awaitingSubAgents) {
        run._awaitingSubAgents = actionCtx._awaitingSubAgents;
        run.status = 'awaiting';
      }
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

    if (run.status === 'awaiting') {
      this.trackAndEmit(run, { type: 'awaiting_sub_agents' });
      return;
    }

    this.trackAndEmit(run, { type: 'done' });
    this.trackAndEmit(run, { type: 'stream_end' });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Private: event tracking + broadcast
  // ═══════════════════════════════════════════════════════════════════════

  private trackAndEmit(run: AgentChatRun, event: AgentEvent): void {
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
    } else if (event.type === 'thinking_delta') {
      const last = run.contentBlocks[run.contentBlocks.length - 1];
      if (last && last.type === 'thinking') {
        last.text += event.text;
      } else {
        run.contentBlocks.push({ type: 'thinking', text: event.text });
      }
    } else if (event.type === 'tool_use_start') {
      if (hasToolCallWithId(run.toolCalls, event.id)) {
        return;
      }
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
          const warningEvent: AgentEvent = {
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
    void _aborted;

    const now = new Date().toISOString();
    const session: AgentChatSession = {
      id: run.sessionId,
      agentId: run.agentId,
      projectKey: run.projectKey,
      title: repairStoredTextIfNeeded(run.sessionTitle) ?? '新会话',
      sourceType: run.sourceType,
      sourceId: run.sourceId,
      todoId: run.todoId,
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
    await persistSessionToDisk(session, this.buildExecutionSummary(run));

    // Emit change event for inbox routing
    try {
      const { changeEmitter } = await import('../change-emitter');
      changeEmitter.emit({
        type: 'session_completed',
        sourceId: run.sessionId,
        summary: `Agent「${run.agentId}」会话已完成`,
        timestamp: new Date().toISOString(),
        projectKey: run.projectKey,
        agentId: run.agentId,
      });
    } catch { /* non-critical */ }

    // ExecutionEvent 归约落盘（纯增量，不影响 messages JSONL，fire-and-forget）
    this.persistExecutionEvents(run).catch(err => {
      console.error(`${LOG_PREFIX} persistExecutionEvents error:`, err);
    });
  }

  /**
   * 从 Turn 的内存累积归约出 ExecutionEvent 列表并追加到 events JSONL。
   * Fire-and-forget：不阻塞 persistAfterClose、不影响用户体验。
   */
  private async persistExecutionEvents(run: AgentChatRun): Promise<void> {
    try {
      const lastUserMsg = [...run.messages].reverse().find(m => m.role === 'user');

      const turnStatus: TurnData['turnStatus'] =
        run.status === 'awaiting' ? 'awaiting'
        : run.status === 'failed' ? 'failed'
        : run.status === 'stopped' ? 'stopped'
        : 'completed';

      const errors = run.events
        .filter((e): e is Extract<AgentEvent, { type: 'error' }> => e.type === 'error')
        .map(e => e.message);

      const turnData: TurnData = {
        sessionId: run.sessionId,
        userContent: lastUserMsg?.content ?? '',
        userImages: lastUserMsg?.images,
        assistantContent: run.assistantText,
        contentBlocks: run.contentBlocks
          .filter((b): b is { type: 'text'; text: string } | { type: 'thinking'; text: string } => 'text' in b)
          .map(b => ({ type: b.type, text: b.text })),
        toolCalls: run.toolCalls,
        errors,
        turnStatus,
        tokenUsage: (run._tokenInputs > 0 || run._tokenOutputs > 0)
          ? { inputTokens: run._tokenInputs, outputTokens: run._tokenOutputs, contextWindow: run._contextWindow }
          : undefined,
        startedAt: run.startedAt,
        completedAt: run.completedAt ?? Date.now(),
      };

      // Auto-run policy:
      // - manual chat: no implicit run (unless user/API already opened one)
      // - trigger/todo/event/schedule: auto-open an implicit run if missing
      let activeRun = await getActiveRun(run.sessionId).catch(() => undefined);
      let autoOpened = false;
      if (!activeRun && run.sourceType !== 'manual') {
        const guessedGoal = (lastUserMsg?.content ?? run.sessionTitle ?? '').trim();
        activeRun = await openRun(run.sessionId, {
          goal: guessedGoal ? guessedGoal.slice(0, 120) : undefined,
          taskId: run.todoId,
          startEventId: 'none',
        }).catch(() => undefined);
        autoOpened = !!activeRun;
      }

      const persistedEvents = reduceAndPersistTurnEvents(turnData, activeRun?.runId);

      // For implicit runs, auto-close when this turn reaches terminal state.
      if (autoOpened && activeRun && turnStatus !== 'awaiting') {
        const outcome: 'success' | 'failure' | 'partial' | 'shelved' =
          turnStatus === 'completed' ? 'success'
          : turnStatus === 'failed' ? 'failure'
          : turnStatus === 'stopped' ? 'shelved'
          : 'partial';
        await closeRun(run.sessionId, activeRun.runId, {
          outcome,
          evaluationText: turnStatus === 'completed'
            ? 'Auto-closed by system after triggered turn completion'
            : `Auto-closed by system with status: ${turnStatus}`,
          endEventId: persistedEvents[persistedEvents.length - 1]?.id,
        }).catch(() => {});
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} persistExecutionEvents error:`, err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Private helpers
  // ═══════════════════════════════════════════════════════════════════════

  private buildExecutionSummary(run: AgentChatRun): SessionExecution {
    const lastError = [...run.events]
      .reverse()
      .find((event): event is Extract<AgentEvent, { type: 'error' }> => event.type === 'error');

    const tokenUsage = (run._tokenInputs > 0 || run._tokenOutputs > 0 || run._contextWindow)
      ? {
          inputTokens: run._tokenInputs,
          outputTokens: run._tokenOutputs,
          contextWindow: run._contextWindow,
        }
      : undefined;

    const executionStatus: SessionExecution['status'] = run.status === 'awaiting'
      ? 'awaiting'
      : run.status === 'failed'
        ? 'failed'
        : run.status === 'stopped'
          ? 'stopped'
          : 'completed';

    return {
      runId: run.runId,
      status: executionStatus,
      startedAt: new Date(run.startedAt).toISOString(),
      completedAt: new Date(run.completedAt ?? Date.now()).toISOString(),
      errorMessage: lastError?.message,
      stopReason: executionStatus === 'stopped' ? 'aborted' : undefined,
      tokenUsage,
      eventCount: run.events.length,
      awaiting: executionStatus === 'awaiting' ? run._awaitingSubAgents : undefined,
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

async function collectPromptGlobMatchPaths(
  sessionId: string | undefined,
  projectKey: string | undefined,
): Promise<string[]> {
  let projectRoot: string | undefined;
  if (projectKey) {
    try {
      const index = await readProjectIndex();
      projectRoot = index.projects.find(p => p.key === projectKey)?.path;
    } catch {
      /* ignore */
    }
  }

  const raw: string[] = [];
  if (sessionId) {
    try {
      const runningTasks = await listRunningTasks();
      const myTask = runningTasks.find(t => t.sessionId === sessionId);
      if (myTask?.scope?.length) raw.push(...myTask.scope);
    } catch {
      /* ignore */
    }
  }

  if (raw.length === 0 && projectRoot) {
    raw.push(projectRoot);
  }

  return normalizePathsForPromptGlobs(raw, projectRoot);
}

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
  const promptGlobMatchPaths = await collectPromptGlobMatchPaths(sessionId, projectKey);

  const baseRefs = agent.defaultResources ?? migrateAgentToResources(agent);
  const merged: Array<ResourceRef | InlineTextRef> = [...baseRefs];

  const hasCallableAgents = merged.some(
    r => 'type' in r && r.type === 'available-agents' && r.id === '_callable',
  );
  if (!hasCallableAgents) {
    merged.push(CALLABLE_AGENTS_RESOURCE_REF);
  }

  merged.push({ type: 'global-prompt', id: '_global', priority: PROMPT_PRIORITY.GLOBAL_PROMPT });
  merged.push({ type: 'inbox-digest', id: '_inbox', priority: PROMPT_PRIORITY.INBOX_DIGEST });

  if (projectKey) {
    merged.push({ type: 'project-prompt', id: '_project', priority: PROMPT_PRIORITY.PROJECT_PROMPT });
  }

  // Inject prompt blocks referenced by agent.promptRefs
  if (agent.promptRefs?.length) {
    for (const blockId of agent.promptRefs) {
      merged.push({ type: 'prompt-block', id: blockId, priority: PROMPT_PRIORITY.PROMPT_BLOCK });
    }
  }

  // ── Code Cards（知识类文档 + tag code-card）与 ActiveTask scope 匹配 ──
  {
    const docsIdx = await readDocsIndexFromDocuments();
    const flatEntries = Object.values(docsIdx.projects).flat();
    const allCodeCards = flatEntries.filter(
      e =>
        e.documentKind === 'knowledge' &&
        e.coveredPaths?.length &&
        e.tags?.includes('code-card') &&
        (!e.status || e.status === 'active') &&
        (!projectKey || e.projectKey === projectKey || e.projectKey === '_global'),
    );

    if (allCodeCards.length > 0) {
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

      const matched =
        scopePaths.length > 0 ? matchCodeCards(scopePaths, flatEntries) : [];

      if (matched.length > 0) {
        for (const card of matched) {
          let inlineContent = '';
          try {
            const p = card.sourcePath ?? path.join(getDocumentsContentDir(), card.fileName);
            inlineContent = await fs.readFile(p, 'utf-8');
          } catch {
            /* missing file */
          }
          merged.push({
            type: 'inline-text',
            id: `_code-card-${card.id}`,
            priority: PROMPT_PRIORITY.CODE_CARD_MATCHED,
            label: `Code Card: ${card.title}`,
            inlineContent,
          });
        }
      } else {
        const indexTable = buildCodeCardIndex(allCodeCards, getDocumentsContentDir());
        if (indexTable) {
          merged.push({
            type: 'inline-text',
            id: '_code-card-index',
            priority: PROMPT_PRIORITY.TODO_LIST_OR_CODE_CARD_INDEX,
            label: 'Code Cards 索引',
            inlineContent: indexTable,
          });
        }
      }

      merged.push({
        type: 'inline-text',
        id: '_code-card-update-reminder',
        priority: PROMPT_PRIORITY.CODE_CARD_REMINDER,
        label: 'Code Card 维护提醒',
        inlineContent:
          '任务完成后，若修改了 Code Card 覆盖范围内的代码，请更新对应知识文档正文。使用 PATCH /api/docs/[id] 更新内容。',
      });
    }
  }

  if (extraRefs) merged.push(...extraRefs);

  // ── Phase 2: Merge contextRefs from active todos assigned to this agent ──
  {
    const todosData = await readTodosMerged();
    const activeTodos = todosData.todos.filter(t =>
      t.status === 'in_progress' &&
      t.agentId === agent.id &&
      t.contextRefs?.length,
    );
    for (const todo of activeTodos) {
      for (const ref of todo.contextRefs!) {
        merged.push({ ...ref, priority: ref.priority ?? PROMPT_PRIORITY.TODO_CONTEXT_REF });
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
      merged.push({ type: 'skill', id: rs.qualifiedId, priority: PROMPT_PRIORITY.SKILL_AUTO });
    }
  }

  if (sessionConfig) {
    // Phase 4: unified resourceRefs take precedence over legacy contextIds/skillNames
    if (sessionConfig.resourceRefs?.length) {
      merged.push(...sessionConfig.resourceRefs);
    }
    if (sessionConfig.skillNames?.length) {
      for (const name of sessionConfig.skillNames) {
        merged.push({ type: 'skill', id: name, priority: PROMPT_PRIORITY.SKILL_SESSION });
      }
    }
    if (sessionConfig.supplementaryPrompt?.trim()) {
      const promptRef: InlineTextRef = {
        type: 'inline-text',
        id: '_session-supplementary',
        priority: PROMPT_PRIORITY.SESSION_SUPPLEMENTARY,
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
    promptGlobMatchPaths,
  };

  const resolvedResources = await resourceRegistry.resolveAll(allRefs, ctx);
  return resourceRegistry.formatAsPrompt(resolvedResources);
}

// ── Prompt Builders (powered by Resource Registry) ──

async function buildAgentChatPrompt(agent: Agent, message: string, sessionConfig?: SessionConfig, sessionId?: string, projectKey?: string, conversationHistory?: string): Promise<string> {
  const resourcePrompt = await buildResourcePrompt(agent, undefined, sessionConfig, sessionId, projectKey);

  const historyBlock = conversationHistory ? `\n${conversationHistory}\n` : '';

  const body = `${resourcePrompt}
${historyBlock}
---

用户消息：${message}`;
  return body;
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
    priority: PROMPT_PRIORITY.FLOW_CONTEXT,
    label: '项目上下文',
    projectKey,
    projectName,
    ...(flowDataPath && { flowDataPath }),
  };

  const resourcePrompt = await buildResourcePrompt(agent, [flowRef], sessionConfig, sessionId, projectKey);

  const historyBlock = conversationHistory ? `\n${conversationHistory}\n` : '';

  const body = `${resourcePrompt}
${historyBlock}
---

用户消息：${message}`;
  return body;
}

async function buildGuestAgentPrompt(
  agent: Agent,
  message: string,
  importedTurns: Array<{ role: 'user' | 'assistant'; content: string }>,
  guestSessionConfig?: SessionConfig,
): Promise<string> {
  const extraRefs: ResourceRef[] = [];

  if (importedTurns.length > 0) {
    const turnsRef: ReferenceTurnsRef = {
      type: 'reference-turns',
      id: '_imported',
      priority: PROMPT_PRIORITY.REFERENCE_TURNS,
      label: '参考对话',
      turns: importedTurns,
    };
    extraRefs.push(turnsRef);
  }

  const resourcePrompt = await buildResourcePrompt(agent, extraRefs, guestSessionConfig);

  const body = `${resourcePrompt}

---

用户消息：${message}`;
  return body;
}

// ── Prompt Preview ──

/**
 * 构建发往模型的 **用户侧资源提示词**（`buildResourcePrompt`：ResourceRegistry 合并）。
 * 平台级安全/工具策略在 SDK `systemPrompt`（`buildSystemLevelPrompt`），不在此字符串中。
 * **不含**多轮对话历史，也**不含**单轮用户消息包装（见 `buildAgentChatPrompt`）。
 * 供 /api/agent-chat/prompt-info 端点调用，用于 UI 展示与体积估算。
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
  options?: { includeText?: boolean },
): Promise<{ charCount: number; estimatedTokens: number; text?: string }> {
  const agent = await loadAgent(agentId);
  const effectiveCaps = mergeCapabilities(agent.capabilities, config?.capabilities);
  const provider = config?.provider ?? agent.defaultProvider ?? 'anthropic';
  const systemText = await buildSystemLevelPrompt({
    agentId,
    capabilities: effectiveCaps,
    projectKey,
    model: config?.model ?? agent.defaultModel,
    provider,
  });
  let userResourceText = await buildResourcePrompt(agent, undefined, config, sessionId, projectKey);
  const combined = `${systemText}\n\n---\n\n${userResourceText}`;
  const charCount = combined.length;
  const estimatedTokens = estimateTokens(combined);
  if (options?.includeText) {
    if (!userResourceText.trim()) {
      userResourceText =
        '[ProjectPilot] 合并后的用户侧资源提示词长度为 0（异常）。请检查：资源加载器是否注册、global/project/agent 提示是否可读，或查看服务端日志中的 ResourceRegistry 警告。（本预览另含上方「SDK systemPrompt」块；不含对话历史与用户消息。）';
    }
    return {
      charCount,
      estimatedTokens,
      text: `${systemText}\n\n---\n\n${userResourceText}`,
    };
  }
  return { charCount, estimatedTokens };
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
