/**
 * Backward-compatible re-export.
 * The actual implementation lives in `./chat-managers/process-manager.ts`.
 */

export { processManager } from './chat-managers/process-manager';
export type { ProcessRun } from './chat-managers/process-manager';
export type { RunStatus, RunStatusInfo } from './chat-managers/types';
