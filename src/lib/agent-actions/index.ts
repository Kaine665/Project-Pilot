/**
 * Agent Actions registration — import this module once to populate the registry.
 *
 * Also registers auto-generated ResourceLoaders for each action,
 * bridging the AgentAction system into the existing Resource system.
 */

import { actionRegistry } from './registry';
import { resourceRegistry } from '../resource-registry';

import { sessionTitleAction } from './session-title';
import { awaitSubAgentsAction } from './await-sub-agents';
import { sessionCheckpointAction } from './session-checkpoint';

// Register all actions
actionRegistry.register(sessionTitleAction);
actionRegistry.register(awaitSubAgentsAction);
actionRegistry.register(sessionCheckpointAction);

// Generate and register ResourceLoaders for backward compatibility
for (const loader of actionRegistry.generateAllLoaders()) {
  resourceRegistry.register(loader);
}

export { actionRegistry } from './registry';
export type { AgentAction, ActionContext } from './types';
