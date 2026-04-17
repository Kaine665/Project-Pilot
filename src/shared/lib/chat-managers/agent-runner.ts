/**
 * agent-runner.ts — 统一的 SDK 执行抽象层。
 *
 * 设计目标：AgentChatManager 只与 IAgentRunner 接口交互，
 * 不感知底层是哪套 SDK。新增 provider 时在 AGENT_RUNNER_FACTORIES 注册即可。
 *
 *   IAgentRunner
 *   ├── ClaudeAgentRunner   (@anthropic-ai/claude-agent-sdk — 全量 Anthropic 兼容供应商)
 *   └── CodexAgentRunner    (@openai/codex-sdk — provider=openai)
 */

import { query, type Query as SdkQuery, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
// @openai/codex-sdk 是纯 ESM 包，静态 import 在 CJS 运行时（tsx/node）会失败。
// 使用动态 import() 绕过这个限制——动态导入走 Node 的 ESM loader，可以加载 ESM-only 包。
import type { Input as CodexInput, Thread } from '@openai/codex-sdk';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { SdkEventAdapter } from '@/lib/sdk-event-adapter';
import { CodexSdkEventAdapter } from '@/lib/codex-sdk-adapter';
import { resolveCodexBinaryPath } from '@/lib/codex-cli';
import { shouldApplyOpenAIFastMode } from '@/lib/openai-fast-mode';
import { DEFAULT_OPENAI_REASONING_EFFORT, normalizeOpenAIReasoningEffort } from '@/lib/openai-reasoning-effort';
import { getAppWorkingDir } from '@/lib/app-paths';
import { buildSdkQueryOptions, buildCodexExecEnv, getEffectiveAuthMode, getProviderScopedModel, getSettings } from '@/lib/settings-manager';
import { buildSystemLevelPrompt, type SystemLevelPromptInput } from '@/lib/system-level-prompt';
import type { AgentEvent, AgentCapabilities, ProviderId } from '@/types';

export type { SystemLevelPromptInput } from '@/lib/system-level-prompt';

/** 运行时统一输入：正文为 UTF-8 字符串；多模态由 StreamOptions.images 传入 */
export type AgentRunnerInput = string;

/** Options passed alongside the main input to stream() */
export interface StreamOptions {
  /** Image attachments to include with the prompt (base64 encoded) */
  images?: Array<{
    mediaType: string;
    data: string; // base64
  }>;
}

// ── Public interface ─────────────────────────────────────────────────────────

/**
 * 统一的 Agent 执行接口。
 * 每个实例对应一次对话轮次（一个 prompt → 一段 stream）。
 */
export interface IAgentRunner {
  /** 流式执行 prompt，yield 领域事件（与传输层解耦，类型名为历史遗留 AgentEvent） */
  stream(input: AgentRunnerInput, options?: StreamOptions): AsyncIterable<AgentEvent>;

  /** 中止当前流 */
  abort(): void;

  /**
   * SDK 捕获的 session ID（用于下次 resume）。
   * 在 stream() 迭代过程中或结束后可读。
   */
  readonly capturedSessionId: string | null;
}

export interface AgentRunnerCreateOptions {
  provider: ProviderId;
  capabilities?: AgentCapabilities;
  model?: string;
  effortOverride?: string;
  fastModeOverride?: boolean;
  resumeSessionId?: string;
  cwd?: string;
  /**
   * Claude Agent SDK：`buildSystemLevelPrompt()` 的输入（平台级 systemPrompt）。
   * OpenAI/Codex 路径当前不使用。
   */
  systemLevelInput?: SystemLevelPromptInput;
}

// ── Registry ─────────────────────────────────────────────────────────────────

type RunnerFactory = (opts: AgentRunnerCreateOptions, cwd: string) => Promise<IAgentRunner>;

/**
 * 按 provider 注册的 Runner 工厂。未注册的 provider 走默认 Claude Agent SDK 路径。
 */
const AGENT_RUNNER_FACTORIES: Partial<Record<ProviderId, RunnerFactory>> = {
  openai: createOpenAiCodexRunner,
};

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * 根据 provider 创建对应的 runner。
 * 调用方无需感知 SDK 细节，只持有 IAgentRunner 引用。
 */
export async function createAgentRunner(opts: AgentRunnerCreateOptions): Promise<IAgentRunner> {
  const cwd = opts.cwd ?? getAppWorkingDir();

  // 1) 显式注册的工厂优先（如 openai → CodexRunner）
  const factory = AGENT_RUNNER_FACTORIES[opts.provider];
  if (factory) {
    console.log(`[AgentRunner] provider=${opts.provider} -> registered factory (local tools via Codex when openai)`);
    return factory(opts, cwd);
  }

  // 2) 其余全部走 Claude Agent SDK（含官方 Anthropic、DeepSeek、Kimi、MiniMax 等全量 Anthropic 兼容供应商）
  console.log(
    `[AgentRunner] provider=${opts.provider} -> ClaudeAgentRunner (Claude Agent SDK; expect tool_use_* when model invokes tools)`,
  );
  return createClaudeAgentRunner(opts, cwd);
}

async function createOpenAiCodexRunner(opts: AgentRunnerCreateOptions, cwd: string): Promise<IAgentRunner> {
  const settings = await getSettings();
  const model =
    opts.model
    ?? getProviderScopedModel(settings.claude, 'openai');
  const modelReasoningEffort = normalizeOpenAIReasoningEffort(
    opts.effortOverride ?? settings.claude.openaiReasoningEffort ?? DEFAULT_OPENAI_REASONING_EFFORT,
  );
  const authMode = getEffectiveAuthMode(settings.claude, 'openai');
  const fastModeEnabled = shouldApplyOpenAIFastMode({
    enabled: opts.fastModeOverride ?? settings.claude.openaiFastMode ?? false,
    model,
    authMode,
  });

  const env = await buildCodexExecEnv();
  const envRecord: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v != null) envRecord[k] = String(v);
  }

  console.log(
    `[CodexRunner:create] model=${model} cwd=${cwd} resume=${opts.resumeSessionId ?? 'none'}`
    + ` effort=${modelReasoningEffort} fastMode=${fastModeEnabled}`
    + ` CODEX_API_KEY_len=${envRecord.CODEX_API_KEY?.length ?? 0}`
    + ` OPENAI_API_KEY_len=${envRecord.OPENAI_API_KEY?.length ?? 0}`,
  );

  const codexPathOverride = resolveCodexBinaryPath();
  console.log(`[AgentRunner] Codex binary override: ${codexPathOverride ?? '(none, SDK will resolve)'}`);

  const { Codex } = await import('@openai/codex-sdk');
  const codex = new Codex({
    env: envRecord,
    ...(fastModeEnabled ? { config: { service_tier: 'fast', features: { fast_mode: true } } } : {}),
    ...(codexPathOverride ? { codexPathOverride } : {}),
  });

  const threadOptions = {
    model,
    ...(modelReasoningEffort ? { modelReasoningEffort } : {}),
    workingDirectory: cwd,
    skipGitRepoCheck: true,
    approvalPolicy: 'never' as const,
    sandboxMode: 'danger-full-access' as const,
  };

  const thread = opts.resumeSessionId
    ? codex.resumeThread(opts.resumeSessionId, threadOptions)
    : codex.startThread(threadOptions);

  return new CodexAgentRunner(thread);
}

async function createClaudeAgentRunner(opts: AgentRunnerCreateOptions, cwd: string): Promise<IAgentRunner> {
  if (!opts.systemLevelInput) {
    throw new Error('[AgentRunner] Claude 路径需要 systemLevelInput（平台级 systemPrompt）');
  }
  const systemPrompt = await buildSystemLevelPrompt(opts.systemLevelInput);

  const sdkOpts = await buildSdkQueryOptions({
    capabilities: opts.capabilities,
    providerOverride: opts.provider,
    modelOverride: opts.model,
    effortOverride: opts.effortOverride,
    resumeSessionId: opts.resumeSessionId,
    cwd,
    systemPrompt,
  });

  // Diagnostic: log key SDK options
  const diagEnv = sdkOpts.env as Record<string, string | undefined>;
  console.log(`[ClaudeRunner:create] model=${sdkOpts.model} cwd=${cwd} resume=${opts.resumeSessionId ?? 'none'} effort=${sdkOpts.effort} permissionMode=${sdkOpts.permissionMode}`);
  console.log(`[ClaudeRunner:create] env: BASE_URL=${diagEnv.ANTHROPIC_BASE_URL ?? '(unset)'} API_KEY_len=${diagEnv.ANTHROPIC_API_KEY?.length ?? 0} AUTH_TOKEN_len=${diagEnv.ANTHROPIC_AUTH_TOKEN?.length ?? 0} DISABLE_TRAFFIC=${diagEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC ?? '(unset)'} TIMEOUT=${diagEnv.API_TIMEOUT_MS ?? '(unset)'}`);

  return new ClaudeAgentRunner(sdkOpts);
}

// ── Claude Agent SDK Runner ──────────────────────────────────────────────────

class ClaudeAgentRunner implements IAgentRunner {
  private _sdkQuery: SdkQuery | null = null;
  private _capturedSessionId: string | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly sdkOpts: any) {}

  async *stream(input: AgentRunnerInput, options?: StreamOptions): AsyncIterable<AgentEvent> {
    const adapter = new SdkEventAdapter();
    const images = options?.images;

    console.log(`[ClaudeRunner] Creating SDK query, model=${this.sdkOpts?.model}, baseUrl=${this.sdkOpts?.env?.ANTHROPIC_BASE_URL ?? '(default)'}`);
    console.log(`[ClaudeRunner] sdkOpts keys: ${Object.keys(this.sdkOpts).join(', ')}`);
    console.log(`[ClaudeRunner] permissionMode=${this.sdkOpts?.permissionMode} allowDangerouslySkipPermissions=${this.sdkOpts?.allowDangerouslySkipPermissions} effort=${this.sdkOpts?.effort} maxTurns=${this.sdkOpts?.maxTurns} thinking=${JSON.stringify(this.sdkOpts?.thinking)} includePartialMessages=${this.sdkOpts?.includePartialMessages} hasStderr=${typeof this.sdkOpts?.stderr === 'function'} DEBUG_SDK=${this.sdkOpts?.env?.DEBUG_CLAUDE_AGENT_SDK}`);
    console.log(`[ClaudeRunner] promptLen=${input.length} promptPreview=${input.slice(0, 200).replace(/\n/g, '\\n')}`);

    if (images && images.length > 0) {
      // Build multimodal prompt: images + text as content blocks inside SDKUserMessage
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contentBlocks: any[] = images.map(img => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType,
          data: img.data,
        },
      }));
      contentBlocks.push({ type: 'text', text: input });

      const userMessage: SDKUserMessage = {
        type: 'user',
        message: { role: 'user', content: contentBlocks },
        parent_tool_use_id: null,
        session_id: `img-${Date.now()}`, // placeholder, SDK captures real session_id from init event
      };

      async function* singleMessage(): AsyncIterable<SDKUserMessage> {
        yield userMessage;
      }

      this._sdkQuery = query({ prompt: singleMessage(), options: this.sdkOpts });
    } else {
      this._sdkQuery = query({ prompt: input, options: this.sdkOpts });
    }

    console.log('[ClaudeRunner] SDK query created, starting iteration...');

    try {
      let msgCount = 0;
      for await (const msg of this._sdkQuery) {
        msgCount++;
        if (msgCount <= 3) {
          console.log(`[ClaudeRunner] SDK msg #${msgCount}: type=${(msg as { type?: string }).type ?? 'unknown'}`);
        }
        yield* adapter.adapt(msg);
      }
      console.log(`[ClaudeRunner] SDK iteration complete, total msgs: ${msgCount}`);
    } catch (err) {
      console.error(`[ClaudeRunner] SDK stream error:`, err);
      throw err;
    } finally {
      if (adapter.sessionId) {
        this._capturedSessionId = adapter.sessionId;
      }
      this._sdkQuery = null;
    }
  }

  abort(): void {
    this._sdkQuery?.close();
    this._sdkQuery = null;
  }

  get capturedSessionId(): string | null {
    return this._capturedSessionId;
  }
}

// ── Codex SDK Runner ─────────────────────────────────────────────────────────

class CodexAgentRunner implements IAgentRunner {
  private _abortController: AbortController | null = null;
  private _capturedSessionId: string | null = null;

  constructor(private readonly thread: Thread) {}

  async *stream(input: AgentRunnerInput, options?: StreamOptions): AsyncIterable<AgentEvent> {
    const adapter = new CodexSdkEventAdapter();

    // Codex SDK uses local_image with file paths — write base64 images to temp files
    const tempPaths: string[] = [];
    let codexInput: CodexInput = input;
    const images = options?.images;
    if (images && images.length > 0) {
      const extMap: Record<string, string> = {
        'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
      };
      const parts: Array<{ type: 'text'; text: string } | { type: 'local_image'; path: string }> = [];
      for (const img of images) {
        const ext = extMap[img.mediaType] ?? 'png';
        const tmpPath = join(tmpdir(), `codex-img-${randomBytes(8).toString('hex')}.${ext}`);
        await writeFile(tmpPath, Buffer.from(img.data, 'base64'));
        tempPaths.push(tmpPath);
        parts.push({ type: 'local_image', path: tmpPath });
      }
      parts.push({ type: 'text', text: input });
      codexInput = parts;
    }

    this._abortController = new AbortController();

    try {
      const { events } = await this.thread.runStreamed(codexInput, {
        signal: this._abortController.signal,
      });

      for await (const ev of events) {
        const { events: chatEvents, sessionId } = adapter.adapt(ev);
        if (sessionId) this._capturedSessionId = sessionId;
        yield* chatEvents;
      }
    } catch (err) {
      // AbortError 是正常中止，不向上传递
      if (err instanceof Error && err.name === 'AbortError') return;
      throw err;
    } finally {
      this._abortController = null;
      // Clean up temp image files
      for (const p of tempPaths) {
        unlink(p).catch(() => {});
      }
    }
  }

  abort(): void {
    this._abortController?.abort();
    this._abortController = null;
  }

  get capturedSessionId(): string | null {
    return this._capturedSessionId;
  }
}
