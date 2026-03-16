/**
 * Satellite task configuration persistence.
 *
 * Stores enabled/disabled state for each satellite task
 * in ~/.project-pilot/data/satellite-tasks-config.json
 */

import path from 'path';
import { getDataDir, readJsonFile, writeJsonFile } from '@/lib/file-store';

// ── Types ──

export interface SatelliteTaskConfig {
  /** Task ID → enabled state. Missing = default (true). */
  enabledMap: Record<string, boolean>;
  /** Task ID → user-configured parameters. Missing = use defaults from schema. */
  paramsMap: Record<string, Record<string, unknown>>;
}

const DEFAULT_CONFIG: SatelliteTaskConfig = {
  enabledMap: {},
  paramsMap: {},
};

// ── File path ──

function getConfigPath(): string {
  return path.join(getDataDir(), 'tasks', 'satellite-config.json');
}

// ── Public API ──

export async function getSatelliteTaskConfig(): Promise<SatelliteTaskConfig> {
  return readJsonFile<SatelliteTaskConfig>(getConfigPath(), DEFAULT_CONFIG);
}

export async function saveSatelliteTaskConfig(config: SatelliteTaskConfig): Promise<void> {
  await writeJsonFile(getConfigPath(), config);
}

/**
 * Check if a specific task is enabled.
 * Tasks default to enabled if not explicitly configured.
 */
export async function isTaskEnabled(taskId: string): Promise<boolean> {
  const config = await getSatelliteTaskConfig();
  return config.enabledMap[taskId] !== false;
}

/**
 * Set enabled/disabled for a specific task.
 */
export async function setTaskEnabled(taskId: string, enabled: boolean): Promise<void> {
  const config = await getSatelliteTaskConfig();
  config.enabledMap[taskId] = enabled;
  await saveSatelliteTaskConfig(config);
}

/**
 * Get user-configured parameters for a task.
 * Returns empty object if no custom params set.
 */
export async function getTaskParams(taskId: string): Promise<Record<string, unknown>> {
  const config = await getSatelliteTaskConfig();
  return config.paramsMap?.[taskId] ?? {};
}

/**
 * Save user-configured parameters for a task.
 * Merges with existing params (partial update).
 */
export async function setTaskParams(taskId: string, params: Record<string, unknown>): Promise<void> {
  const config = await getSatelliteTaskConfig();
  if (!config.paramsMap) config.paramsMap = {};
  config.paramsMap[taskId] = params;
  await saveSatelliteTaskConfig(config);
}
