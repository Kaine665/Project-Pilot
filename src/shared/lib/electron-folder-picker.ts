/**
 * 选择本地文件夹：
 * 1. Electron 桌面版 → window.electron.openFolderDialog()（IPC）
 * 2. 非 Electron（浏览器 Vite dev）→ POST /api/fs/pick-folder（服务端弹系统对话框）
 */

export function hasElectronFolderPicker(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof (window as any).electron?.openFolderDialog === 'function';
}

export function canPickFolder(): boolean {
  return true; // 总是可用：Electron 用 IPC，浏览器用服务端 API
}

export async function pickLocalFolderPath(): Promise<string | null> {
  // 优先 Electron IPC
  const bridge = (window as any).electron;
  if (typeof bridge?.openFolderDialog === 'function') {
    try {
      console.log('[pick-folder] using Electron IPC…');
      const result: string | null = await bridge.openFolderDialog();
      console.log('[pick-folder] IPC result:', result);
      return result?.trim() || null;
    } catch (err) {
      console.error('[pick-folder] IPC error:', err);
    }
  }

  // 回退：服务端 API（PowerShell / osascript / zenity）
  try {
    console.log('[pick-folder] using server API…');
    const res = await fetch('/api/fs/pick-folder', { method: 'POST' });
    if (!res.ok) {
      console.warn('[pick-folder] server responded', res.status);
      return null;
    }
    const data: { path: string | null; error?: string } = await res.json();
    console.log('[pick-folder] server result:', data);
    return data.path?.trim() || null;
  } catch (err) {
    console.error('[pick-folder] server error:', err);
    return null;
  }
}
