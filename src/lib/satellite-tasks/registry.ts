/**
 * SatelliteRegistry — singleton registry for satellite tasks.
 *
 * Tasks are registered at import time (side-effect) and consumed
 * by the SatelliteScheduler during finalizeRun.
 */

import type { SatelliteTask } from './types';

class SatelliteRegistry {
  private tasks = new Map<string, SatelliteTask>();

  register(task: SatelliteTask): void {
    if (this.tasks.has(task.id)) {
      console.warn(`[SatelliteRegistry] Overwriting task: ${task.id}`);
    }
    this.tasks.set(task.id, task);
  }

  get(id: string): SatelliteTask | undefined {
    return this.tasks.get(id);
  }

  /** Get all tasks sorted by priority (ascending) */
  getAllSorted(): SatelliteTask[] {
    return [...this.tasks.values()].sort((a, b) => a.priority - b.priority);
  }
}

// ── Singleton (HMR-safe) ──

const g = globalThis as unknown as { __satelliteRegistry?: SatelliteRegistry };
export const satelliteRegistry = g.__satelliteRegistry ?? new SatelliteRegistry();
if (process.env.NODE_ENV !== 'production') {
  g.__satelliteRegistry = satelliteRegistry;
}
