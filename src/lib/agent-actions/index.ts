/**
 * Agent Actions registration — import this module once to populate the registry.
 *
 * Also registers auto-generated ResourceLoaders for each action,
 * bridging the AgentAction system into the existing Resource system.
 */

import { actionRegistry } from './registry';
import { resourceRegistry } from '../resource-registry';

import { saveKnowledgeAction } from './save-knowledge';
import { saveDocAction } from './save-doc';
import { sessionTitleAction } from './session-title';
import { suspendTaskAction } from './suspend-task';
import { completeSuspendedTaskAction } from './complete-suspended-task';
import { awaitSubAgentsAction } from './await-sub-agents';

// Register all actions
actionRegistry.register(saveKnowledgeAction);
actionRegistry.register(saveDocAction);
actionRegistry.register(sessionTitleAction);
actionRegistry.register(suspendTaskAction);
actionRegistry.register(completeSuspendedTaskAction);
actionRegistry.register(awaitSubAgentsAction);

// Generate and register ResourceLoaders for backward compatibility
for (const loader of actionRegistry.generateAllLoaders()) {
  resourceRegistry.register(loader);
}

export { actionRegistry } from './registry';
export type { AgentAction, ActionContext } from './types';
