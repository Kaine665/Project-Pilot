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
}

const DEFAULT_CONFIG: SatelliteTaskConfig = {
  enabledMap: {},
};

// ── File path ──

function getConfigPath(): string {
  return path.join(getDataDir(), 'satellite-tasks-config.json');
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
