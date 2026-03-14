/**
 * Preload script — 通过 contextBridge 向渲染进程暴露安全的 API
 */
import { contextBridge, ipcRenderer } from 'electron';

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
  }) => ipcRenderer.invoke('show-notification', options),
});
