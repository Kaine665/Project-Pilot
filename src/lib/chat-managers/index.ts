/**
 * Unified export for the chat manager hierarchy.
 *
 * External consumers import from here or from the backward-compatible
 * re-export files at `@/lib/process-manager` and `@/lib/agent-chat-manager`.
 */

// ── Base ──
export { BaseChatManager } from './base-chat-manager';

// ── Types ──
export type { BaseRun, RunStatus, RunStatusInfo, SpawnConfig } from './types';

// ── AgentChatManager (stateful singleton) ──
export { agentChatManager, generateSessionId } from './agent-chat-manager';
export type {
  AgentChatRun,
  ImageAttachment,
  ImageMediaType,
  FlowContext,
} from './agent-chat-manager';

// ── Session Store (stateless functions, HMR-friendly) ──
export {
  loadSession,
  listSessions,
  listSessionsByProject,
  listAllSessions,
  listGuestSessions,
  markAsRead,
  setArchived,
  updateConfigOnDisk,
  loadDeferredInputBuffer,
  loadPendingUserQueueOnDisk,
  updateDeferredInputBufferOnDisk,
  updatePendingUserQueueOnDisk,
  updateUserMessageContentOnDisk,
  deleteSessionFromDisk,
  branchSession,
  loadAgent,
} from './agent-chat-session-store';
