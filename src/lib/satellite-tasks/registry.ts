/**
 * SatelliteRegistry — HMR-safe singleton that holds all registered satellite tasks.
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

  getAll(): SatelliteTask[] {
    return [...this.tasks.values()];
  }

  /** Return tasks sorted by priority (ascending = lower priority number first). */
  getAllSorted(): SatelliteTask[] {
    return this.getAll().sort((a, b) => a.priority - b.priority);
  }
}

// ── Singleton (HMR-safe) ──

const g = globalThis as unknown as { __satelliteRegistry?: SatelliteRegistry };
export const satelliteRegistry = g.__satelliteRegistry ?? new SatelliteRegistry();
if (process.env.NODE_ENV !== 'production') {
  g.__satelliteRegistry = satelliteRegistry;
}
