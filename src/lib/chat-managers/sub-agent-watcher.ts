/**
 * SubAgentWatcher — 监控 Sub Agent 会话完成状态，自动唤醒父 Agent。
 *
 * 当父 Agent 进入 awaiting 状态后，watcher 每 5 秒检查一次目标 session 的状态。
 * 全部终止（completed/failed/stopped）或超时后，收集结果摘要并恢复父 Agent。
 */

// ── Types ──

export interface WatchEntry {
  parentSessionId: string;
  parentAgentId: string;
  parentProjectKey?: string;
  targetSessionIds: string[];
  registeredAt: number;
  timeoutMs: number;
}

/** Minimal interface for the manager methods we need (avoids circular imports) */
export interface WatcherManagerBridge {
  getStatus(runKey: string): { status: string };
  getMessages(sessionId: string): Array<{ role: string; content: string }>;
  start(
    sessionId: string,
    agentId: string,
    message: string,
  ): Promise<string>;
}

// ── Constants ──

const POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const LOG_PREFIX = '[SubAgentWatcher]';

// Terminal statuses (run is done, won't change)
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'stopped', 'none']);

// ── SubAgentWatcher ──

export class SubAgentWatcher {
  private entries = new Map<string, WatchEntry>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private manager: WatcherManagerBridge | null = null;

  /**
   * Bind the manager reference. Called once during AgentChatManager construction.
   * Separate from constructor to break circular dependency.
   */
  bind(manager: WatcherManagerBridge): void {
    this.manager = manager;
  }

  /**
   * Register a watch entry. Starts the polling timer if not already running.
   */
  register(entry: WatchEntry): void {
    console.log(
      `${LOG_PREFIX} Registered: parent=${entry.parentSessionId}, targets=[${entry.targetSessionIds.join(',')}], timeout=${entry.timeoutMs}ms`,
    );
    this.entries.set(entry.parentSessionId, entry);
    this.ensureTimer();
  }

  /**
   * Unregister a watch entry.
   */
  unregister(parentSessionId: string): void {
    this.entries.delete(parentSessionId);
    if (this.entries.size === 0) {
      this.stopTimer();
    }
  }

  /**
   * Get a watch entry (used for persistence).
   */
  getEntry(parentSessionId: string): WatchEntry | undefined {
    return this.entries.get(parentSessionId);
  }

  /**
   * Get all watch entries (used for sidecar restart recovery).
   */
  getAllEntries(): WatchEntry[] {
    return [...this.entries.values()];
  }

  /**
   * Restore entries from disk (sidecar restart recovery).
   */
  restoreEntries(entries: WatchEntry[]): void {
    for (const entry of entries) {
      this.entries.set(entry.parentSessionId, entry);
    }
    if (this.entries.size > 0) {
      this.ensureTimer();
      console.log(`${LOG_PREFIX} Restored ${entries.length} watch entries from disk`);
    }
  }

  // ── Private ──

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    if (this.timer && typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref();
    }
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    if (!this.manager || this.entries.size === 0) return;

    for (const [parentSessionId, entry] of this.entries) {
      try {
        await this.checkEntry(entry);
      } catch (err) {
        console.error(`${LOG_PREFIX} Error checking entry for ${parentSessionId}:`, err);
      }
    }
  }

  private async checkEntry(entry: WatchEntry): Promise<void> {
    if (!this.manager) return;

    const now = Date.now();
    const elapsed = now - entry.registeredAt;
    const timedOut = elapsed >= entry.timeoutMs;

    // Check status of all target sessions
    const results: Array<{
      sessionId: string;
      status: string;
      summary: string;
    }> = [];

    let allDone = true;
    for (const targetId of entry.targetSessionIds) {
      const statusInfo = this.manager.getStatus(targetId);
      const status = statusInfo.status;

      if (TERMINAL_STATUSES.has(status)) {
        // Get last assistant message as summary
        const messages = this.manager.getMessages(targetId);
        const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
        const summary = lastAssistant
          ? lastAssistant.content.slice(0, 300)
          : '(无输出)';
        results.push({ sessionId: targetId, status, summary });
      } else {
        allDone = false;
        results.push({ sessionId: targetId, status, summary: '(仍在运行中)' });
      }
    }

    // If timed out or all done → wake up parent
    if (allDone || timedOut) {
      const wakeMessage = this.buildWakeMessage(results, timedOut);
      console.log(
        `${LOG_PREFIX} Waking parent=${entry.parentSessionId} (allDone=${allDone}, timedOut=${timedOut})`,
      );

      // Unregister before resuming to prevent re-trigger
      this.unregister(entry.parentSessionId);

      try {
        await this.manager.start(
          entry.parentSessionId,
          entry.parentAgentId,
          wakeMessage,
        );
        console.log(`${LOG_PREFIX} Parent ${entry.parentSessionId} resumed successfully`);
      } catch (err) {
        console.error(
          `${LOG_PREFIX} Failed to resume parent ${entry.parentSessionId}:`,
          err,
        );
      }
    }
  }

  private buildWakeMessage(
    results: Array<{ sessionId: string; status: string; summary: string }>,
    timedOut: boolean,
  ): string {
    const lines: string[] = [];

    if (timedOut) {
      lines.push('你之前启动的 Sub Agent 任务等待超时，当前状态如下：\n');
    } else {
      lines.push('你之前启动的 Sub Agent 任务已全部完成，结果如下：\n');
    }

    for (const r of results) {
      const icon = r.status === 'completed' ? '✅'
        : r.status === 'failed' ? '❌'
        : r.status === 'stopped' ? '⏹️'
        : '⏳';
      lines.push(`- [${r.sessionId}] ${icon} ${r.status} — ${r.summary}`);
    }

    lines.push('\n请根据结果继续处理。');
    return lines.join('\n');
  }
}

// ── Singleton (HMR-safe) ──

const g = globalThis as unknown as { __subAgentWatcher?: SubAgentWatcher };
export const subAgentWatcher = g.__subAgentWatcher ?? new SubAgentWatcher();
if (process.env.NODE_ENV !== 'production') {
  g.__subAgentWatcher = subAgentWatcher;
}

export { DEFAULT_TIMEOUT_MS as WATCHER_DEFAULT_TIMEOUT_MS };
