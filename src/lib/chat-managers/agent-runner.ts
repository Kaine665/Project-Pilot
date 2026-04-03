/**
 * agent-runner.ts — 统一的 SDK 执行抽象层。
 *
 * 设计目标：AgentChatManager 只与 IAgentRunner 接口交互，
 * 不感知底层是哪套 SDK。新增 provider 时在 AGENT_RUNNER_FACTORIES 注册即可。
 *
 *   IAgentRunner
 *   ├── ClaudeAgentRunner        (@anthropic-ai/claude-agent-sdk — 仅 Anthropic 官方)
 *   ├── SimpleAnthropicRunner    (裸 Anthropic Messages API — 第三方兼容端)
 *   └── CodexAgentRunner         (@openai/codex-sdk)
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
import { buildSdkQueryOptions, buildClaudeEnv, buildCodexExecEnv, getEffectiveAuthMode, getProviderScopedModel, getSettings } from '@/lib/settings-manager';
import type { AgentEvent, AgentCapabilities, ProviderId } from '@/types';

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
}

// ── Registry ─────────────────────────────────────────────────────────────────

type RunnerFactory = (opts: AgentRunnerCreateOptions, cwd: string) => Promise<IAgentRunner>;

/**
 * 按 provider 注册的 Runner 工厂。未注册的 provider 走默认 Claude Agent SDK 路径。
 */
const AGENT_RUNNER_FACTORIES: Partial<Record<ProviderId, RunnerFactory>> = {
  openai: createOpenAiCodexRunner,
};

/** 需要走 Claude Agent SDK（完整 Agent 协议）的供应商。其余走 SimpleAnthropicRunner。 */
const CLAUDE_AGENT_SDK_PROVIDERS = new Set<ProviderId>(['anthropic']);

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

  // 2) 官方 Anthropic → ClaudeAgentRunner（完整 Agent SDK）
  if (CLAUDE_AGENT_SDK_PROVIDERS.has(opts.provider)) {
    console.log(`[AgentRunner] provider=${opts.provider} -> ClaudeAgentRunner (Claude Agent SDK; expect tool_use_* when model invokes tools)`);
    return createClaudeAgentRunner(opts, cwd);
  }

  // 3) 第三方 Anthropic 兼容端 → SimpleAnthropicRunner（裸 Messages API）
  console.log(
    `[AgentRunner] provider=${opts.provider} -> SimpleAnthropicRunner (Messages API only; no local Read/Bash/tool_use — expect text_delta only)`,
  );
  return createSimpleAnthropicRunner(opts, cwd);
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
  const sdkOpts = await buildSdkQueryOptions({
    capabilities: opts.capabilities,
    providerOverride: opts.provider,
    modelOverride: opts.model,
    effortOverride: opts.effortOverride,
    resumeSessionId: opts.resumeSessionId,
    cwd,
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

// ── Simple Anthropic Runner (第三方兼容端) ────────────────────────────────────

async function createSimpleAnthropicRunner(opts: AgentRunnerCreateOptions, cwd: string): Promise<IAgentRunner> {
  const env = await buildClaudeEnv(opts.provider, opts.effortOverride, opts.model);
  const model = opts.model ?? (await getSettings().then(s => getProviderScopedModel(s.claude, opts.provider)));
  const baseUrl = (env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, '');
  const apiKey = env.ANTHROPIC_API_KEY ?? '';
  const authToken = env.ANTHROPIC_AUTH_TOKEN ?? '';
  // 经验规则：
  // - ANTHROPIC_API_KEY   -> 默认用 x-api-key（DeepSeek/Kimi/智谱常见）
  // - ANTHROPIC_AUTH_TOKEN -> 默认用 Authorization（OpenRouter/部分 custom 常见）
  // 但供应商网关并不总是稳定遵循上述约定，stream() 里还有 401 自适应重试兜底。
  const authScheme: 'x-api-key' | 'bearer' = apiKey ? 'x-api-key' : 'bearer';
  const token = apiKey || authToken;

  console.log(
    `[SimpleAnthropicRunner:create] provider=${opts.provider} model=${model}`
    + ` baseUrl=${baseUrl} auth=${authScheme} tokenLen=${token.length}`,
  );

  return new SimpleAnthropicRunner({ baseUrl, token, authScheme, model: model ?? 'deepseek-chat' });
}

interface SimpleAnthropicConfig {
  baseUrl: string;
  token: string;
  authScheme: 'x-api-key' | 'bearer';
  model: string;
}

/**
 * 用裸 fetch + SSE 调用 Anthropic Messages API。
 * 适用于 DeepSeek、Qwen、OpenRouter 等只兼容基本 Messages 协议的供应商。
 * 不支持 Agent 工具调用——纯文本对话。
 */
class SimpleAnthropicRunner implements IAgentRunner {
  private _abortController: AbortController | null = null;
  private _sessionId: string | null = null;

  constructor(private readonly config: SimpleAnthropicConfig) {}

  async *stream(input: AgentRunnerInput, _options?: StreamOptions): AsyncIterable<AgentEvent> {
    const url = `${this.config.baseUrl}/v1/messages`;
    this._abortController = new AbortController();

    const body = JSON.stringify({
      model: this.config.model,
      max_tokens: 8192,
      stream: true,
      messages: [{ role: 'user', content: input }],
    });

    console.log(`[SimpleAnthropicRunner] POST ${url} model=${this.config.model} inputLen=${input.length}`);

    let response: Response;
    let firstAuthErrorBody = '';
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(this.config.authScheme),
        body,
        signal: this._abortController.signal,
      });

      // 某些供应商网关要求固定鉴权头（如 MiniMax 可能要求 Authorization）。
      // 若 401 且报文提示鉴权头不匹配，自动切换头重试一次。
      //
      // 场景示例：
      // - 当前发 x-api-key，返回 “Please carry ... in Authorization” -> 改用 Bearer 重试
      // - 当前发 Bearer，返回 “missing x-api-key”                 -> 改用 x-api-key 重试
      //
      // 设计目标：将“供应商头部差异”收敛在 runner 层，避免把兼容逻辑扩散到上层业务。
      if (!response.ok && response.status === 401) {
        firstAuthErrorBody = await response.text().catch(() => '');
        const needAuthorization = /authorization/i.test(firstAuthErrorBody);
        const needApiKeyHeader = /x-api-key|api[_ -]?key/i.test(firstAuthErrorBody);
        if (this.config.authScheme === 'x-api-key' && needAuthorization) {
          console.warn('[SimpleAnthropicRunner] 401 with x-api-key, retrying with Authorization');
          response = await fetch(url, {
            method: 'POST',
            headers: this.buildHeaders('bearer'),
            body,
            signal: this._abortController.signal,
          });
        } else if (this.config.authScheme === 'bearer' && needApiKeyHeader) {
          console.warn('[SimpleAnthropicRunner] 401 with Authorization, retrying with x-api-key');
          response = await fetch(url, {
            method: 'POST',
            headers: this.buildHeaders('x-api-key'),
            body,
            signal: this._abortController.signal,
          });
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('[SimpleAnthropicRunner] fetch error:', err);
      yield { type: 'error', message: `Request failed: ${err}` };
      return;
    }

    if (!response.ok) {
      const text = firstAuthErrorBody || await response.text().catch(() => '(unreadable)');
      console.error(`[SimpleAnthropicRunner] HTTP ${response.status}: ${text}`);
      yield { type: 'error', message: `API returned ${response.status}: ${text}` };
      return;
    }

    if (!response.body) {
      yield { type: 'error', message: 'Response has no body' };
      return;
    }

    yield* this._parseSSE(response.body);
  }

  private buildHeaders(scheme: 'x-api-key' | 'bearer'): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (scheme === 'x-api-key') {
      headers['x-api-key'] = this.config.token;
    } else {
      headers.authorization = `Bearer ${this.config.token}`;
    }
    return headers;
  }

  private async *_parseSSE(body: ReadableStream<Uint8Array>): AsyncIterable<AgentEvent> {
    const decoder = new TextDecoder();
    const reader = body.getReader();
    let buffer = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
            continue;
          }
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') return;

          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const parsed: any = JSON.parse(data);

            if (eventType === 'message_start' && parsed.message?.id) {
              this._sessionId = parsed.message.id;
              const usage = parsed.message?.usage;
              if (usage) inputTokens = usage.input_tokens ?? 0;
            } else if (eventType === 'content_block_delta') {
              const delta = parsed.delta;
              if (delta?.type === 'text_delta' && delta.text) {
                yield { type: 'text_delta', text: delta.text };
              } else if (delta?.type === 'thinking_delta' && delta.thinking) {
                yield { type: 'thinking_delta', text: delta.thinking };
              }
            } else if (eventType === 'message_delta') {
              const usage = parsed.usage;
              if (usage) outputTokens = usage.output_tokens ?? 0;
            }
          } catch {
            // Ignore malformed JSON lines
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('[SimpleAnthropicRunner] SSE read error:', err);
      yield { type: 'error', message: `Stream error: ${err}` };
    } finally {
      reader.releaseLock();
      if (inputTokens > 0 || outputTokens > 0) {
        yield { type: 'token_usage', inputTokens, outputTokens, final: true };
      }
    }
  }

  abort(): void {
    this._abortController?.abort();
    this._abortController = null;
  }

  get capturedSessionId(): string | null {
    return this._sessionId;
  }
}
