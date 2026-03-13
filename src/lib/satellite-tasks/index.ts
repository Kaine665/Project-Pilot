/**
 * Satellite Tasks — side-effect registration + re-exports.
 *
 * Import this module to register all satellite tasks with the registry.
 */

import { satelliteRegistry } from './registry';
import { titleGenerationTask } from './tasks/title-generation';
import { healthGuardTask } from './tasks/health-guard';

// ── Register all tasks ──

satelliteRegistry.register(titleGenerationTask);
satelliteRegistry.register(healthGuardTask);

// ── Re-exports ──

export { satelliteRegistry } from './registry';
export { runSatelliteTasks } from './scheduler';
export type { SatelliteTask, SatelliteContext } from './types';
