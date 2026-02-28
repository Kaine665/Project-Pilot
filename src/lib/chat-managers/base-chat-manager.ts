/**
 * BaseChatManager — Abstract base class for Claude subprocess management.
 *
 * Encapsulates the process lifecycle that ProcessManager and AgentChatManager
 * share: spawn, stdout/stderr parsing, event tracking/broadcast, subscribe,
 * stop, status query, and periodic sweep.
 *
 * Subclasses implement:
 *   - createRun()          — build the domain-specific TRun from a BaseRun shell
 *   - persistAfterClose()  — save conversation/session data to disk
 *
 * Subclasses may override hooks:
 *   - onProcessClose()     — extract artifacts, titles, etc. before persist
 *   - onStop()             — additional cleanup when user stops the process
 *   - onDangerousCritical()— react to critical-level dangerous commands
 *   - logPrefix            — customize console log prefix
 */

import { spawn } from 'child_process';
import { StreamParser, LineBuffer } from '@/lib/claude-stream-parser';
import { detectDangerousCommand } from '@/lib/danger-detector';
import type { ChatSSEEvent, ChatToolCall, ContentBlock } from '@/types';
import type { BaseRun, RunStatus, RunStatusInfo, SpawnConfig } from './types';

// ── Constants ──

const SWEEP_INTERVAL_MS = 60_000;

// ── Abstract base ──

export abstract class BaseChatManager<TRun extends BaseRun> {
  protected runs = new Map<string, TRun>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  /** How long to keep completed runs in memory before sweeping (ms). */
  protected abstract readonly completedTtlMs: number;

  /** Console log prefix, e.g. "[PM]" or "[AgentChat]". */
  protected abstract readonly logPrefix: string;

  constructor() {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    if (this.sweepTimer && typeof this.sweepTimer === 'object' && 'unref' in this.sweepTimer) {
      this.sweepTimer.unref();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Public API (fully implemented by base — subclasses inherit as-is)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Subscribe to a run's event stream.
   * Replays events from `since`, then delivers live events.
   * Returns an unsubscribe function, or null if no run exists for the key.
   */
  subscribe(
    runKey: string,
    since: number,
    listener: (event: ChatSSEEvent, index: number) => void,
  ): (() => void) | null {
    const run = this.runs.get(runKey);
    if (!run) return null;

    // Replay buffered events
    for (let i = since; i < run.events.length; i++) {
      listener(run.events[i], i);
    }

    // If already done, no live subscription needed
    if (run.status !== 'running') {
      return () => {};
    }

    run.listeners.add(listener);
    return () => {
      run.listeners.delete(listener);
    };
  }

  /**
   * Query the status of a run.
   */
  getStatus(runKey: string): RunStatusInfo {
    const run = this.runs.get(runKey);
    if (!run) {
      return { status: 'none', eventCount: 0 };
    }
    return {
      status: run.status,
      runId: run.runId,
      eventCount: run.events.length,
      startedAt: new Date(run.startedAt).toISOString(),
    };
  }

  /**
   * Stop a running process.
   * Sends SIGTERM and calls the onStop hook for subclass-specific cleanup.
   */
  async stop(runKey: string): Promise<boolean> {
    const run = this.runs.get(runKey);
    if (!run || run.status !== 'running') return false;
    run.status = 'stopped';
    if (run.process) {
      run.process.kill('SIGTERM');
    }
    await this.onStop(runKey, run);
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Abstract methods (subclass MUST implement)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Create the domain-specific TRun object.
   * Called by spawnAndManage with a pre-built BaseRun shell.
   */
  protected abstract createRun(config: SpawnConfig, shell: BaseRun): TRun;

  /**
   * Persist conversation/session data after the Claude process exits.
   */
  protected abstract persistAfterClose(run: TRun, aborted: boolean): Promise<void>;

  // ═══════════════════════════════════════════════════════════════════════
  // Overridable hooks (default = no-op)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Called after stop() kills the process.
   * ProcessManager overrides this to clean up the git worktree.
   */
  protected async onStop(_runKey: string, _run: TRun): Promise<void> {}

  /**
   * Called inside the close handler, BEFORE persistAfterClose.
   * Use this for artifact extraction, title extraction, etc.
   * The streamParser is passed so subclasses can read the captured sessionId.
   */
  protected async onProcessClose(
    _run: TRun,
    _aborted: boolean,
    _streamParser: StreamParser,
  ): Promise<void> {}

  /**
   * Called when a critical-level dangerous command is detected.
   * Default: auto-stop the process. Subclasses can override if needed.
   */
  protected onDangerousCritical(run: TRun, reason: string): void {
    console.warn(`${this.logPrefix} CRITICAL danger detected, auto-stopping: ${reason}`);
    run.status = 'stopped';
    if (run.process) {
      run.process.kill('SIGTERM');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Core engine (protected — called by subclass start() methods)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Spawn a Claude subprocess and wire up stdout/stderr/close/error handling.
   *
   * This is the "template method" — the invariant skeleton of the process
   * lifecycle. Subclasses call this from their own start() after building
   * the SpawnConfig.
   */
  protected async spawnAndManage(config: SpawnConfig): Promise<TRun> {
    const {
      runKey,
      workingDir,
      stdinContent,
      extraCliArgs,
    } = config;

    // ── Build BaseRun shell ──
    const runId = `run-${runKey}-${Date.now()}`;
    const shell: BaseRun = {
      runId,
      process: null,
      status: 'running' as RunStatus,
      events: [],
      listeners: new Set(),
      startedAt: Date.now(),
      assistantText: '',
      contentBlocks: [],
      toolCalls: [],
      claudeSessionId: config.claudeSessionId,
    };

    // ── Let subclass build the full TRun ──
    const run = this.createRun(config, shell);
    this.runs.set(runKey, run);

    // ── Build CLI args ──
    // Note: auth env, model, maxTurns, permissions, tools, resume, image
    // args are all pre-built by the subclass and passed in extraCliArgs.
    const claude = spawn('claude', [
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
      ...extraCliArgs,
    ], {
      cwd: workingDir,
      shell: false, // 🔒 Security: disable shell to prevent command injection
      env: config.env as NodeJS.ProcessEnv,
    });
    run.process = claude;

    // ── Write stdin ──
    claude.stdin.write(stdinContent);
    claude.stdin.end();

    // ── stdout parsing ──
    const lineBuffer = new LineBuffer();
    const streamParser = new StreamParser();

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

    // ── stderr ──
    claude.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      if (text.includes('Error') || text.includes('error')) {
        this.trackAndEmit(run, { type: 'error', message: text.trim() });
      }
    });

    // ── close ──
    claude.on('close', async (code) => {
      run.process = null;

      // Flush remaining buffer
      const remaining = lineBuffer.flush();
      if (remaining) {
        const events = streamParser.parse(remaining);
        for (const event of events) {
          this.trackAndEmit(run, event);
        }
      }

      const aborted = run.status === 'stopped';

      if (code !== 0 && !run.assistantText && !aborted) {
        this.trackAndEmit(run, { type: 'error', message: `Claude exited with code ${code}` });
      }

      // Capture session ID for resume
      if (streamParser.sessionId) {
        run.claudeSessionId = streamParser.sessionId;
      }

      // Subclass hook (artifacts, titles, knowledge tags, etc.)
      await this.onProcessClose(run, aborted, streamParser);

      // Persist to disk
      await this.persistAfterClose(run, aborted);

      // Subclass-provided post-persist callback (e.g. conversation index update)
      if (config.onBeforeEmitDone) {
        await config.onBeforeEmitDone();
      }

      // Emit done and finalize status
      this.trackAndEmit(run, { type: 'done' });
      if (run.status === 'running') {
        run.status = code === 0 ? 'completed' : 'failed';
      }
      run.completedAt = Date.now();
    });

    // ── error (spawn failure) ──
    claude.on('error', async (err) => {
      this.trackAndEmit(run, { type: 'error', message: `Failed to spawn claude: ${err.message}` });
      this.trackAndEmit(run, { type: 'done' });
      run.status = 'failed';
      run.completedAt = Date.now();
      run.process = null;
      await this.persistAfterClose(run, false);
    });

    return run;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Event tracking + broadcast (protected — used by subclass and base)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Track an SSE event in the run's accumulation state, perform danger
   * detection, and broadcast to all live listeners.
   */
  protected trackAndEmit(run: TRun, event: ChatSSEEvent): void {
    // ── Accumulate ──
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

      // ── Danger detection (unified for all managers) ──
      if (event.toolName === 'Bash') {
        const danger = detectDangerousCommand(event.input);
        if (danger) {
          const warningEvent: ChatSSEEvent = {
            type: 'dangerous_tool_warning',
            toolCallId: event.id,
            toolName: event.toolName,
            command: event.input,
            reason: danger.reason,
            level: danger.level,
          };
          // Direct emit to avoid recursion
          const wIdx = run.events.length;
          run.events.push(warningEvent);
          for (const listener of run.listeners) {
            try { listener(warningEvent, wIdx); } catch { /* */ }
          }

          if (danger.level === 'critical') {
            this.onDangerousCritical(run, danger.reason);
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

    // ── Broadcast ──
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
  // Private
  // ═══════════════════════════════════════════════════════════════════════

  private sweep(): void {
    const now = Date.now();
    for (const [key, run] of this.runs) {
      if (
        run.status !== 'running' &&
        run.completedAt &&
        now - run.completedAt > this.completedTtlMs
      ) {
        this.runs.delete(key);
      }
    }
  }
}
