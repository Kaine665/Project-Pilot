/**
 * Preload script — 通过 contextBridge 向渲染进程暴露安全的 API
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  IPC_AGENT_EVENT_CHANNEL,
  type IndexedAgentEventPayload,
} from './ipc-channels';

contextBridge.exposeInMainWorld('electron', {
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  /** 将渲染进程 <input type="file"> 选中的 File 转为绝对路径（Electron ≥22，用于 webkitdirectory 选文件夹） */
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  openFile: (path: string) => ipcRenderer.invoke('open-file', path),
  /** 系统浏览器打开链接（OAuth 等） */
  openExternalUrl: (url: string) =>
    ipcRenderer.invoke('open-external-url', url) as Promise<{ ok?: true; error?: string }>,
  /** OAuth 完成后把焦点拉回主窗口 */
  focusMainWindow: () => ipcRenderer.invoke('focus-main-window') as Promise<void>,
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
