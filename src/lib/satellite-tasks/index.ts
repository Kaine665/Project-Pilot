/**
 * Satellite Tasks registration — import this module once (side-effect)
 * to populate the registry with all built-in satellite tasks.
 */

import { satelliteRegistry } from './registry';
import { titleGenerationTask } from './tasks/title-generation';
import { healthGuardTask } from './tasks/health-guard';
import { knowledgeExtractionTask } from './tasks/knowledge-extraction';
import { topicCompletionTask } from './tasks/topic-completion';
import { todoAutoCompleteTask } from './tasks/todo-auto-complete';
import { activeTaskCleanupTask } from './tasks/active-task-cleanup';
import { taskCardGenerationTask } from './tasks/task-card-generation';
import { codeCardRefreshTask } from './tasks/code-card-refresh';

// Register all built-in satellite tasks
satelliteRegistry.register(activeTaskCleanupTask);
satelliteRegistry.register(taskCardGenerationTask);
satelliteRegistry.register(codeCardRefreshTask);
satelliteRegistry.register(titleGenerationTask);
satelliteRegistry.register(healthGuardTask);
satelliteRegistry.register(knowledgeExtractionTask);
satelliteRegistry.register(topicCompletionTask);
satelliteRegistry.register(todoAutoCompleteTask);

// Re-exports
export { satelliteRegistry } from './registry';
export { runSatelliteTasks } from './scheduler';
export type { SatelliteContext, SatelliteTask, TaskConfigSchema, ConfigFieldSchema } from './types';
export { getSatelliteTaskConfig, setTaskEnabled, getTaskParams, setTaskParams } from './config';
export { appendRun, getRunsByTask, clearRunsByTask, getRunStats } from './run-store';
export type { SatelliteTaskRun } from './run-store';
