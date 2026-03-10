/**
 * AgentChatManager — Lightweight Claude subprocess manager for Agent conversations.
 *
 * This class ONLY manages stateful operations that depend on in-memory process
 * state (this.runs Map). All pure data operations (session CRUD, agent loading)
 * are in agent-chat-session-store.ts as standalone functions.
 *
 * Why: The class instance is cached on globalThis to survive HMR (so running
 * processes aren't lost). But that means new methods added to the class won't
 * be available until a server restart. By keeping data operations as standalone
 * functions, they get proper HMR updates.
 */

import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { BaseChatManager } from './base-chat-manager';
import type { BaseRun, SpawnConfig } from './types';
import type { StreamParser } from '@/lib/claude-stream-parser';
import { getAppWorkingDir } from '@/lib/app-paths';
import { getPromptFilePath } from '@/lib/file-store';
import { resolveSystemPrompt, createRuntimePromptCopy } from '@/lib/agent-prompt-store';
import {
  buildClaudeEnv,
  buildClaudeModelArgs,
  buildClaudeMaxTurnsArgs,
  buildAgentPermissionArgs,
  buildAgentToolArgs,
} from '@/lib/settings-manager';
import { checkClaudeCliHealth } from '@/lib/claude-cli';
import { getProviderPreset } from '@/lib/provider-registry';
import type { ChatSSEEvent, ContentBlock, Agent, AgentCapabilities, ProviderId } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';
import type { AgentChatSession, SessionConfig } from '@/types/agent-chat';
import type { ResourceRef, InlineTextRef, FlowContextRef, ReferenceTurnsRef } from '@/types/resource';
import { resourceRegistry } from '@/lib/resource-registry';
import '@/lib/resource-loaders'; // side-effect: registers non-action loaders
import '@/lib/agent-actions';    // side-effect: registers actions + their loaders
import { actionRegistry } from '@/lib/agent-actions';
import { migrateAgentToResources } from '@/lib/resource-migration';
import type { SystemPromptLoaderContext } from '@/lib/resource-loaders/system-prompt-loader';
import { checkSessionHealth, buildGuardMessage } from './session-health-guard';
import { shouldGenerateTitle, generateSessionTitle } from '@/lib/session-title-generator';

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

export interface AgentChatRun extends BaseRun {
  sessionId: string;
  agentId: string;
  projectKey?: string;
  sessionTitle?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; images?: string[]; contentBlocks?: ContentBlock[] }>;
  config?: SessionConfig;
  parentSessionId?: string;
  importedTurnIndices?: number[];
  _tempImagePaths?: string[];
  _guardRetryCount?: number;
  /** 临时测试会话，不持久化到会话列表 */
  _ephemeral?: boolean;
}

// ── Domain data (passed through SpawnConfig to createRun) ──

interface AgentChatDomainData {
  sessionId: string;
  agentId: string;
  projectKey?: string;
  sessionTitle?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; images?: string[]; contentBlocks?: ContentBlock[] }>;
  tempPaths: string[];
  config?: SessionConfig;
  parentSessionId?: string;
  importedTurnIndices?: number[];
  _ephemeral?: boolean;
}

// ── AgentChatManager ──

class AgentChatManager extends BaseChatManager<AgentChatRun> {
  protected readonly completedTtlMs = 10 * 60 * 1000; // 10 minutes
  protected readonly logPrefix = '[AgentChat]';

  // ═══════════════════════════════════════════════════════════════════════
  // Public: start a conversation (stateful — uses this.runs)
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

    const isResume = !!existing?.claudeSessionId;

    const messages = existing?.messages ? [...existing.messages] : [];
    const dataUrls = images?.map(img => `data:${img.mediaType};base64,${img.data}`);
    messages.push({ role: 'user', content: message, images: dataUrls?.length ? dataUrls : undefined });

    const sessionConfig = initialConfig ?? existing?.config;

    // ── Resolve provider / model with priority chain ──
    // Priority: explicit override → session config → agent default → (empty = global settings)
    const resolvedProvider = providerOverride
      || sessionConfig?.provider
      || agent.defaultProvider
      || undefined;
    const resolvedModel = modelOverride
      || sessionConfig?.model
      || agent.defaultModel
      || undefined;

    // Persist resolved provider/model into session config so subsequent
    // messages in the same session reuse the same model automatically.
    const persistedConfig: SessionConfig = {
      ...sessionConfig,
      ...(resolvedProvider ? { provider: resolvedProvider } : {}),
      ...(resolvedModel ? { model: resolvedModel } : {}),
    };

    // Build prompt
    // 注意：不区分 isResume，始终发送完整 prompt（含系统提示词）。
    // --resume 仍然用于恢复对话历史，但不依赖它来携带系统提示词。
    // 这样即使 Claude CLI 本地缓存失效（--resume 静默失败），
    // Claude 也能从 stdin 中获取系统提示词，不会出现"没有上下文"的情况。
    const sessionProjectKey = flowContext?.projectKey ?? existing?.projectKey;

    let stdinContent: string;
    if (flowContext) {
      stdinContent = await buildAgentChatPromptWithFlowContext(agent, message, flowContext, persistedConfig, sessionId);
    } else {
      stdinContent = await buildAgentChatPrompt(agent, message, persistedConfig, sessionId, sessionProjectKey);
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

    // ── Pre-flight checks ──
    const cliHealth = checkClaudeCliHealth();
    if (!cliHealth.ok) {
      throw new Error(cliHealth.diagnostic || 'Claude CLI 不可用');
    }

    // Build CLI args (using resolved provider/model from priority chain)
    const chatEnv = await buildClaudeEnv(resolvedProvider, effortOverride);
    const chatModelArgs = await buildClaudeModelArgs(resolvedModel);
    const chatMaxTurnsArgs = await buildClaudeMaxTurnsArgs();
    const effectiveCaps = mergeCapabilities(agent.capabilities, persistedConfig?.capabilities);
    const chatPermArgs = await buildAgentPermissionArgs(effectiveCaps);
    const chatToolArgs = buildAgentToolArgs(effectiveCaps);
    const resumeArgs = isResume ? ['--resume', existing!.claudeSessionId!] : [];

    const config: SpawnConfig<AgentChatDomainData> = {
      runKey: sessionId,
      workingDir: getAppWorkingDir(),
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
      domainData: {
        sessionId,
        agentId,
        projectKey: flowContext?.projectKey ?? existing?.projectKey,
        sessionTitle: existing?.sessionTitle ?? initialTitle,
        messages,
        tempPaths,
        config: persistedConfig,
        parentSessionId: parentSessionId ?? existing?.parentSessionId,
        _ephemeral: ephemeral,
      },
    };

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

    const run = await this.spawnAndManage(config);
    return run.runId;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Public: start a guest (spectator) session (stateful — uses this.runs)
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

    // 同 start()：始终发送完整 prompt，不因 isResume 而省略系统提示词
    const stdinContent = await buildGuestAgentPrompt(agent, message, selectedTurns);

    const chatEnv = await buildClaudeEnv();
    const chatModelArgs = await buildClaudeModelArgs();
    const chatMaxTurnsArgs = await buildClaudeMaxTurnsArgs();
    const chatPermArgs = await buildAgentPermissionArgs(agent.capabilities);
    const chatToolArgs = buildAgentToolArgs(agent.capabilities);
    const resumeArgs = isResume ? ['--resume', existing!.claudeSessionId!] : [];

    const config: SpawnConfig<AgentChatDomainData> = {
      runKey: guestSessionId,
      workingDir: getAppWorkingDir(),
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
      domainData: {
        sessionId: guestSessionId,
        agentId,
        sessionTitle: existing?.sessionTitle,
        messages,
        tempPaths: [],
        parentSessionId,
        importedTurnIndices: turnIndices,
      },
    };

    const run = await this.spawnAndManage(config);
    return run.runId;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Public: in-memory state queries (stateful — reads this.runs)
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

  // ═══════════════════════════════════════════════════════════════════════
  // Public: hybrid methods (this.runs + disk, delegate disk to store)
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
  // Protected: BaseChatManager abstract implementations
  // ═══════════════════════════════════════════════════════════════════════

  protected createRun(config: SpawnConfig<AgentChatDomainData>, shell: BaseRun): AgentChatRun {
    const d = config.domainData;
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
      _ephemeral: d._ephemeral,
    };
  }

  protected async persistAfterClose(run: AgentChatRun, _aborted: boolean): Promise<void> {
    if (run._ephemeral) {
      return;
    }

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

    // ── Session Health Guard ──
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

        // Bump guard retry count in memory and on disk
        const memRun = this.runs.get(run.sessionId);
        if (memRun) {
          memRun._guardRetryCount = (memRun._guardRetryCount ?? 0) + 1;
        }
        await incrementGuardRetryCountOnDisk(run.sessionId);

        const guardMsg = buildGuardMessage(run.status, result.reason);
        try {
          await this.start(run.sessionId, run.agentId, guardMsg);
          console.log(`${this.logPrefix} Health guard resumed session ${run.sessionId}`);
        } catch (err) {
          console.error(`${this.logPrefix} Health guard failed to resume session:`, err);
        }
      }).catch(err => console.error(`${this.logPrefix} Health guard error:`, err));
    }
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

      // Clean contentBlocks text entries
      const cleanedBlocks = run.contentBlocks.map(block => {
        if (block.type === 'text') {
          return { ...block, text: actionRegistry.stripAll(block.text) };
        }
        return block;
      }).filter(block => !(block.type === 'text' && !block.text.trim()));

      // Push assistant message BEFORE title generation so the generator sees the full conversation
      run.messages.push({
        role: 'assistant',
        content: cleaned,
        contentBlocks: cleanedBlocks.length > 0 ? cleanedBlocks : undefined,
      });

      // Async title generation via cheap AI at turn milestones (2/5/10/15)
      const assistantTurnCount = run.messages.filter(m => m.role === 'assistant').length;
      if (shouldGenerateTitle(assistantTurnCount)) {
        try {
          const aiTitle = await generateSessionTitle(
            run.messages.map(m => ({ role: m.role, content: m.content })),
            run.sessionTitle,
          );
          if (aiTitle) run.sessionTitle = aiTitle;
        } catch (err) {
          console.error(`${this.logPrefix} Title generation failed:`, err);
        }
      }

      // Fallback title if still not set
      if (!run.sessionTitle) {
        const firstUserMsg = run.messages.find(m => m.role === 'user')?.content;
        const defaultTitle = run.parentSessionId ? '旁听会话' : '新会话';
        run.sessionTitle = firstUserMsg ? firstUserMsg.slice(0, 30) + '...' : defaultTitle;
      }

      // Emit structured title event so frontend can update immediately
      this.trackAndEmit(run, { type: 'session_title_set', title: run.sessionTitle });
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
      _guardRetryCount: diskSession.guardRetryCount,
    };
  }
}

// ── Capability Merge Helper ──

/** 合并 Agent 和会话级别的能力配置。会话只能收紧（关闭已开启的能力），不能放宽。 */
function mergeCapabilities(
  agentCaps?: AgentCapabilities,
  sessionCaps?: Partial<AgentCapabilities>,
): AgentCapabilities {
  const base = { ...DEFAULT_AGENT_CAPABILITIES, ...agentCaps };
  if (!sessionCaps) return base;
  const merged = { ...base };
  for (const key of Object.keys(sessionCaps) as Array<keyof AgentCapabilities>) {
    if (sessionCaps[key] === undefined) continue;
    // 只能收紧：agent 开了的可以关，agent 没开的不能开
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

  // 全局 prompt（始终注入，priority 1 — 仅次于系统提示词）
  merged.push({ type: 'global-prompt', id: '_global', priority: 1 });

  // 项目级 prompt（有 projectKey 时注入，priority 2）
  if (projectKey) {
    merged.push({ type: 'project-prompt', id: '_project', priority: 2 });
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

  // 系统提示词优先级：sessionConfig.systemPrompt > prompts/{agentId}.md > agent.systemPrompt
  const resolved = sessionConfig?.systemPrompt?.trim()
    ? sessionConfig.systemPrompt.trim()
    : await resolveSystemPrompt(agent.id, agent.systemPrompt);
  const systemPromptText = resolved
    || `你是一个名为「${agent.name}」的 AI 助手。${agent.description || ''}`;

  // 能力合并（用于 exposePromptPath 判断）
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

// ── Singleton ──

const globalForAC = globalThis as unknown as {
  __agentChatManager?: AgentChatManager;
};

export const agentChatManager =
  globalForAC.__agentChatManager ?? new AgentChatManager();

if (process.env.NODE_ENV !== 'production') {
  globalForAC.__agentChatManager = agentChatManager;
}
