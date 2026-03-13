/**
 * Satellite Tasks registration — import this module once (side-effect)
 * to populate the registry with all built-in satellite tasks.
 */

import { satelliteRegistry } from './registry';
import { titleGenerationTask } from './tasks/title-generation';
import { healthGuardTask } from './tasks/health-guard';

// Register all built-in satellite tasks
satelliteRegistry.register(titleGenerationTask);
satelliteRegistry.register(healthGuardTask);

// Re-exports
export { satelliteRegistry } from './registry';
export { runSatelliteTasks } from './scheduler';
export type { SatelliteContext, SatelliteTask } from './types';
export { getSatelliteTaskConfig, setTaskEnabled } from './config';
