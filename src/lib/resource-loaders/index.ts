/**
 * Resource loader registration — import this module once to populate the registry.
 */

import { resourceRegistry } from '../resource-registry';
import { ContextResourceLoader } from './context-loader';
import { ContextIndexLoader } from './context-index-loader';
import { SystemPromptLoader } from './system-prompt-loader';
import { TodoListLoader } from './todo-list-loader';
import { InlineTextLoader } from './inline-text-loader';
import {
  KnowledgeInstructionsLoader,
  DocSaveInstructionsLoader,
  SessionTitleInstructionsLoader,
  FlowContextLoader,
  ReferenceTurnsLoader,
} from './static-text-loader';

resourceRegistry.register(new ContextResourceLoader());
resourceRegistry.register(new ContextIndexLoader());
resourceRegistry.register(new SystemPromptLoader());
resourceRegistry.register(new TodoListLoader());
resourceRegistry.register(new InlineTextLoader());
resourceRegistry.register(new KnowledgeInstructionsLoader());
resourceRegistry.register(new DocSaveInstructionsLoader());
resourceRegistry.register(new SessionTitleInstructionsLoader());
resourceRegistry.register(new FlowContextLoader());
resourceRegistry.register(new ReferenceTurnsLoader());
