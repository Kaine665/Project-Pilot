/**
 * Backward-compatible re-export.
 * The actual implementation lives in `./chat-managers/agent-chat-manager.ts`.
 */

export { agentChatManager, generateSessionId } from './chat-managers/agent-chat-manager';
export type {
  AgentChatRun,
  ImageAttachment,
  ImageMediaType,
  FlowContext,
} from './chat-managers/agent-chat-manager';
export type { RunStatus, RunStatusInfo } from './chat-managers/types';
