/** 与 WorkspaceSidebarRail / TopNav 共用：侧栏迷你模式持久化 */

const STORAGE_KEY = 'pp.workspaceSidebarRail.collapsed';

export function readWorkspaceSidebarRailMini(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeWorkspaceSidebarRailMini(mini: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, mini ? '1' : '0');
  } catch {
    /* ignore */
  }
}
