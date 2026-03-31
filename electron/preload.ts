/**
 * Preload script — 通过 contextBridge 向渲染进程暴露安全的 API
 */
import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_AGENT_EVENT_CHANNEL,
  type IndexedAgentEventPayload,
} from './ipc-channels';

contextBridge.exposeInMainWorld('electron', {
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  openFile: (path: string) => ipcRenderer.invoke('open-file', path),
});

contextBridge.exposeInMainWorld('electronAPI', {
  showNotification: (options: {
    title: string;
    body: string;
    icon?: string;
    tag?: string;
    sessionId?: string;
    requireInteraction?: boolean;
    focusAppOnClick?: boolean;
  }) => ipcRenderer.invoke('show-notification', options),

  // Phase 3: 通知点击事件监听
  onNotificationClicked: (
    callback: (data: { sessionId?: string; timestamp: number }) => void
  ) => {
    const handler = (_event: unknown, data: { sessionId?: string; timestamp: number }) => {
      callback(data);
    };
    ipcRenderer.on('notification-clicked', handler);
    return () => {
      ipcRenderer.removeListener('notification-clicked', handler);
    };
  },
});

/** 备用：main 内 Agent 走 IPC 时订阅（当前未发送，与 SSE 二选一接线） */
contextBridge.exposeInMainWorld('electronAgent', {
  onAgentEvent: (callback: (payload: IndexedAgentEventPayload) => void) => {
    const handler = (_event: unknown, payload: IndexedAgentEventPayload) => {
      callback(payload);
    };
    ipcRenderer.on(IPC_AGENT_EVENT_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(IPC_AGENT_EVENT_CHANNEL, handler);
    };
  },
});
