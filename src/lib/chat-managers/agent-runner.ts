/**
 * agent-runner.ts — 统一的 SDK 执行抽象层。
 *
 * 设计目标：AgentChatManager 只与 IAgentRunner 接口交互，
 * 不感知底层是哪套 SDK。新增 provider 时只需实现 IAgentRunner 接口。
 *
 *   IAgentRunner
 *   ├── ClaudeAgentRunner   (@anthropic-ai/claude-agent-sdk)
 *   └── CodexAgentRunner    (@openai/codex-sdk)
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
import { adaptCodexEvent } from '@/lib/codex-sdk-adapter';
import { resolveCodexBinaryPath } from '@/lib/codex-cli';
import { getAppWorkingDir } from '@/lib/app-paths';
import { buildSdkQueryOptions, buildCodexExecEnv, getProviderScopedModel, getSettings } from '@/lib/settings-manager';
import type { ChatSSEEvent, AgentCapabilities, ProviderId } from '@/types';
export type AgentRunnerInput = string | AsyncIterable<SDKUserMessage> | CodexInput;

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
  /** 流式执行 prompt，yield ChatSSEEvent */
  stream(input: AgentRunnerInput, options?: StreamOptions): AsyncIterable<ChatSSEEvent>;

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
  resumeSessionId?: string;
  cwd?: string;
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * 根据 provider 创建对应的 runner。
 * 调用方无需感知 SDK 细节，只持有 IAgentRunner 引用。
 */
export async function createAgentRunner(opts: AgentRunnerCreateOptions): Promise<IAgentRunner> {
  const cwd = opts.cwd ?? getAppWorkingDir();

  if (opts.provider === 'openai') {
    const settings = await getSettings();
    const model =
      opts.model
      ?? getProviderScopedModel(settings.claude, 'openai');

    const env = await buildCodexExecEnv();
    const envRecord: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      if (v != null) envRecord[k] = String(v);
    }

    const codexPathOverride = resolveCodexBinaryPath();
    console.log(`[AgentRunner] Codex binary override: ${codexPathOverride ?? '(none, SDK will resolve)'}`);

    // 动态 import 确保在 CJS 环境（tsx/sidecar）也能加载 ESM-only 的 codex-sdk
    const { Codex } = await import('@openai/codex-sdk');
    const codex = new Codex({
      env: envRecord,
      ...(codexPathOverride ? { codexPathOverride } : {}),
    });

    const threadOptions = {
      model,
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

  // Claude Agent SDK（Anthropic、custom-anthropic 等）
  const sdkOpts = await buildSdkQueryOptions({
    capabilities: opts.capabilities,
    providerOverride: opts.provider,
    modelOverride: opts.model,
    effortOverride: opts.effortOverride,
    resumeSessionId: opts.resumeSessionId,
    cwd,
  });

  return new ClaudeAgentRunner(sdkOpts);
}

// ── Claude Agent SDK Runner ──────────────────────────────────────────────────

class ClaudeAgentRunner implements IAgentRunner {
  private _sdkQuery: SdkQuery | null = null;
  private _capturedSessionId: string | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly sdkOpts: any) {}

  async *stream(input: AgentRunnerInput, options?: StreamOptions): AsyncIterable<ChatSSEEvent> {
    if (Array.isArray(input)) {
      throw new Error('Claude runner does not accept Codex structured input');
    }

    const adapter = new SdkEventAdapter();
    const images = options?.images;

    if (images && images.length > 0 && typeof input === 'string') {
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

    try {
      for await (const msg of this._sdkQuery) {
        yield* adapter.adapt(msg);
      }
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

  async *stream(input: AgentRunnerInput, options?: StreamOptions): AsyncIterable<ChatSSEEvent> {
    if (isAsyncIterable(input)) {
      throw new Error('Codex runner does not accept Claude message streams');
    }

    // Codex SDK uses local_image with file paths — write base64 images to temp files
    const tempPaths: string[] = [];
    let codexInput: CodexInput = input;
    const images = options?.images;
    if (images && images.length > 0 && typeof input === 'string') {
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
        const { events: chatEvents, sessionId } = adaptCodexEvent(ev);
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

function isAsyncIterable(value: AgentRunnerInput): value is AsyncIterable<SDKUserMessage> {
  return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}
