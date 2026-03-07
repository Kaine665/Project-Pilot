/**
 * Backward-compatible re-export.
 * The actual implementation lives in `./chat-managers/`.
 */

export { agentChatManager, generateSessionId } from './chat-managers/agent-chat-manager';
export type {
  AgentChatRun,
  ImageAttachment,
  ImageMediaType,
  FlowContext,
} from './chat-managers/agent-chat-manager';
export type { RunStatus, RunStatusInfo } from './chat-managers/types';

// Session Store (stateless functions, HMR-friendly)
export {
  loadSession,
  listSessions,
  listSessionsByProject,
  listAllSessions,
  listGuestSessions,
  markAsRead,
  setArchived,
  updateConfigOnDisk,
  deleteSessionFromDisk,
  branchSession,
  loadAgent,
} from './chat-managers/agent-chat-session-store';
