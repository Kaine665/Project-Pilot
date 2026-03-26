/**
 * Usage Store — JSONL-backed token usage tracking.
 *
 * Architecture:
 *   - Main file (usage/token-usage.jsonl): append-only, one JSON record per line
 *   - Summary cache (usage/token-usage-summary.json): aggregated stats, rebuilt on demand
 *
 * Write safety:
 *   - JSONL append is atomic at OS level for small writes (< PIPE_BUF)
 *   - Worst case on crash: lose last incomplete line, all previous records intact
 *   - Summary cache uses atomic write (tmp + rename) via writeJsonFile
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getDataDir, writeJsonFile, readJsonFile } from './file-store';

// ── Types ──

export interface UsageRecord {
  /** ISO timestamp */
  ts: string;
  /** Session ID */
  sessionId: string;
  /** Agent ID */
  agentId: string;
  /** Project key (if any) */
  projectKey?: string;
  /** Model name (e.g. "claude-sonnet-4-20250514") */
  model?: string;
  /** Total input tokens (cumulative for the run) */
  inputTokens: number;
  /** Total output tokens (cumulative for the run) */
  outputTokens: number;
  /** Context window size */
  contextWindow?: number;
}

export interface UsageSummary {
  /** When this summary was last rebuilt */
  lastRebuilt: string;
  /** Total records processed */
  recordCount: number;
  /** Aggregated by agent */
  byAgent: Record<string, AgentUsageStats>;
  /** Aggregated by project */
  byProject: Record<string, ProjectUsageStats>;
  /** Aggregated by date (YYYY-MM-DD) */
  byDate: Record<string, DailyUsageStats>;
}

interface AgentUsageStats {
  totalInput: number;
  totalOutput: number;
  sessionCount: number;
  lastUsedAt: string;
}

interface ProjectUsageStats {
  totalInput: number;
  totalOutput: number;
  sessionCount: number;
}

interface DailyUsageStats {
  totalInput: number;
  totalOutput: number;
  sessionCount: number;
}

// ── Paths ──

function getUsageDir(): string {
  return path.join(getDataDir(), 'usage');
}

function getUsageJSONLPath(): string {
  return path.join(getUsageDir(), 'token-usage.jsonl');
}

function getUsageSummaryPath(): string {
  return path.join(getUsageDir(), 'token-usage-summary.json');
}

// ── Write ──

/**
 * Append a usage record to the JSONL file.
 * Creates the directory and file if they don't exist.
 */
export async function appendUsageRecord(record: UsageRecord): Promise<void> {
  const dir = getUsageDir();
  await fs.mkdir(dir, { recursive: true });

  const line = JSON.stringify(record) + '\n';
  await fs.appendFile(getUsageJSONLPath(), line, 'utf-8');
}

// ── Read ──

/**
 * Read all usage records from the JSONL file.
 * Skips malformed lines gracefully.
 */
export async function readAllUsageRecords(): Promise<UsageRecord[]> {
  const filePath = getUsageJSONLPath();
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch {
    return []; // file doesn't exist yet
  }

  const records: UsageRecord[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed line (e.g. partial write from crash)
      console.warn('[usage-store] Skipping malformed JSONL line');
    }
  }
  return records;
}

/**
 * Read usage records with optional filters.
 */
export async function queryUsageRecords(filters?: {
  agentId?: string;
  projectKey?: string;
  sessionId?: string;
  since?: string; // ISO date
  until?: string; // ISO date
}): Promise<UsageRecord[]> {
  let records = await readAllUsageRecords();

  if (filters?.agentId) {
    records = records.filter(r => r.agentId === filters.agentId);
  }
  if (filters?.projectKey) {
    records = records.filter(r => r.projectKey === filters.projectKey);
  }
  if (filters?.sessionId) {
    records = records.filter(r => r.sessionId === filters.sessionId);
  }
  if (filters?.since) {
    records = records.filter(r => r.ts >= filters.since!);
  }
  if (filters?.until) {
    records = records.filter(r => r.ts <= filters.until!);
  }

  return records;
}

// ── Summary ──

const EMPTY_SUMMARY: UsageSummary = {
  lastRebuilt: '',
  recordCount: 0,
  byAgent: {},
  byProject: {},
  byDate: {},
};

/**
 * Build a fresh summary from all JSONL records.
 */
function buildSummary(records: UsageRecord[]): UsageSummary {
  const summary: UsageSummary = {
    lastRebuilt: new Date().toISOString(),
    recordCount: records.length,
    byAgent: {},
    byProject: {},
    byDate: {},
  };

  for (const r of records) {
    // By agent
    if (!summary.byAgent[r.agentId]) {
      summary.byAgent[r.agentId] = { totalInput: 0, totalOutput: 0, sessionCount: 0, lastUsedAt: r.ts };
    }
    const a = summary.byAgent[r.agentId];
    a.totalInput += r.inputTokens;
    a.totalOutput += r.outputTokens;
    a.sessionCount += 1;
    if (r.ts > a.lastUsedAt) a.lastUsedAt = r.ts;

    // By project
    const pk = r.projectKey || '_global';
    if (!summary.byProject[pk]) {
      summary.byProject[pk] = { totalInput: 0, totalOutput: 0, sessionCount: 0 };
    }
    const p = summary.byProject[pk];
    p.totalInput += r.inputTokens;
    p.totalOutput += r.outputTokens;
    p.sessionCount += 1;

    // By date
    const date = r.ts.slice(0, 10); // YYYY-MM-DD
    if (!summary.byDate[date]) {
      summary.byDate[date] = { totalInput: 0, totalOutput: 0, sessionCount: 0 };
    }
    const d = summary.byDate[date];
    d.totalInput += r.inputTokens;
    d.totalOutput += r.outputTokens;
    d.sessionCount += 1;
  }

  return summary;
}

/**
 * Get usage summary. Rebuilds from JSONL if stale or missing.
 */
export async function getUsageSummary(forceRebuild = false): Promise<UsageSummary> {
  if (!forceRebuild) {
    try {
      const cached = await readJsonFile<UsageSummary>(getUsageSummaryPath(), EMPTY_SUMMARY);
      // Check if JSONL has new records since last rebuild
      const records = await readAllUsageRecords();
      if (cached.recordCount === records.length && cached.recordCount > 0) {
        return cached;
      }
      // Stale — rebuild
      const summary = buildSummary(records);
      await writeJsonFile(getUsageSummaryPath(), summary);
      return summary;
    } catch {
      // Fall through to full rebuild
    }
  }

  const records = await readAllUsageRecords();
  const summary = buildSummary(records);
  try {
    await writeJsonFile(getUsageSummaryPath(), summary);
  } catch {
    // Non-critical — summary is just a cache
  }
  return summary;
}

/**
 * Get usage stats for a specific session (sum of all records for that session).
 */
export async function getSessionUsage(sessionId: string): Promise<{ inputTokens: number; outputTokens: number } | null> {
  const records = await queryUsageRecords({ sessionId });
  if (records.length === 0) return null;

  let inputTokens = 0;
  let outputTokens = 0;
  for (const r of records) {
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
  }
  return { inputTokens, outputTokens };
}
