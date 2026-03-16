/**
 * Satellite task execution record store.
 *
 * Stores run records in JSONL files, one per task:
 *   ~/.project-pilot/data/satellite-task-runs/{taskId}.jsonl
 *
 * Each line is a JSON object representing one execution.
 * Automatically trims to MAX_RECORDS_PER_TASK when appending.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getDataDir } from '@/lib/file-store';

// ── Types ──

export interface SatelliteTaskRun {
  id: string;
  taskId: string;
  sessionId: string;
  agentId: string;
  timestamp: number;
  durationMs: number;
  status: 'success' | 'skipped' | 'failed';
  detail?: string;
}

// ── Constants ──

const MAX_RECORDS_PER_TASK = 200;

// ── Internal helpers ──

function getRunsDir(): string {
  return path.join(getDataDir(), 'tasks', 'satellite-runs');
}

function getRunsFilePath(taskId: string): string {
  const safe = taskId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(getRunsDir(), `${safe}.jsonl`);
}

function generateRunId(): string {
  return `sr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── Public API ──

/**
 * Append a run record. Auto-trims old records beyond MAX_RECORDS_PER_TASK.
 */
export async function appendRun(run: Omit<SatelliteTaskRun, 'id'>): Promise<SatelliteTaskRun> {
  const fullRun: SatelliteTaskRun = { id: generateRunId(), ...run };
  const filePath = getRunsFilePath(run.taskId);

  // Ensure directory exists
  await fs.mkdir(getRunsDir(), { recursive: true });

  // Read existing lines, append, trim
  let lines: string[] = [];
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    lines = content.trim().split('\n').filter(Boolean);
  } catch {
    // File doesn't exist yet
  }

  lines.push(JSON.stringify(fullRun));

  // Trim oldest records if over limit
  if (lines.length > MAX_RECORDS_PER_TASK) {
    lines = lines.slice(lines.length - MAX_RECORDS_PER_TASK);
  }

  await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf-8');
  return fullRun;
}

/**
 * Read run records for a specific task.
 * Returns newest first (reversed from file order).
 * @param limit Max records to return (default 50)
 * @param offset Skip first N records (default 0)
 */
export async function getRunsByTask(
  taskId: string,
  limit = 50,
  offset = 0,
): Promise<{ runs: SatelliteTaskRun[]; total: number }> {
  const filePath = getRunsFilePath(taskId);

  let lines: string[] = [];
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    lines = content.trim().split('\n').filter(Boolean);
  } catch {
    return { runs: [], total: 0 };
  }

  const total = lines.length;

  // Reverse for newest-first, then paginate
  const reversed = lines.reverse();
  const page = reversed.slice(offset, offset + limit);

  const runs = page.map(line => {
    try {
      return JSON.parse(line) as SatelliteTaskRun;
    } catch {
      return null;
    }
  }).filter((r): r is SatelliteTaskRun => r !== null);

  return { runs, total };
}

/**
 * Clear all run records for a specific task.
 */
export async function clearRunsByTask(taskId: string): Promise<void> {
  const filePath = getRunsFilePath(taskId);
  try {
    await fs.unlink(filePath);
  } catch {
    // File doesn't exist, that's fine
  }
}

/**
 * Get summary stats for a task (total, success, failed, last run time).
 */
export async function getRunStats(taskId: string): Promise<{
  total: number;
  success: number;
  failed: number;
  skipped: number;
  lastRunAt: number | null;
  avgDurationMs: number | null;
}> {
  const filePath = getRunsFilePath(taskId);

  let lines: string[] = [];
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    lines = content.trim().split('\n').filter(Boolean);
  } catch {
    return { total: 0, success: 0, failed: 0, skipped: 0, lastRunAt: null, avgDurationMs: null };
  }

  let success = 0;
  let failed = 0;
  let skipped = 0;
  let lastRunAt: number | null = null;
  let totalDuration = 0;
  let durationCount = 0;

  for (const line of lines) {
    try {
      const run = JSON.parse(line) as SatelliteTaskRun;
      if (run.status === 'success') success++;
      else if (run.status === 'failed') failed++;
      else if (run.status === 'skipped') skipped++;

      if (run.durationMs > 0) {
        totalDuration += run.durationMs;
        durationCount++;
      }
      if (lastRunAt === null || run.timestamp > lastRunAt) {
        lastRunAt = run.timestamp;
      }
    } catch {
      // Skip malformed lines
    }
  }

  return {
    total: lines.length,
    success,
    failed,
    skipped,
    lastRunAt,
    avgDurationMs: durationCount > 0 ? Math.round(totalDuration / durationCount) : null,
  };
}
