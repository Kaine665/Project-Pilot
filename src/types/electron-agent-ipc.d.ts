/**
 * Preload 暴露的 Agent IPC（备用）；与 electron/ipc-channels.ts 同构。
 */
export interface IndexedAgentEventPayload {
  event: { type: string; [key: string]: unknown };
  index: number;
}

declare global {
  interface Window {
    electronAgent?: {
      onAgentEvent: (callback: (payload: IndexedAgentEventPayload) => void) => () => void;
    };
  }
}

export {};
