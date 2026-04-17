/** 与 WorkspaceSidebarRail / TopNav 共用：桌面端左侧轨是否完全隐藏（持久化） */

const STORAGE_KEY_HIDDEN = 'pp.workspaceSidebarRail.hidden';

export function readWorkspaceSidebarRailHidden(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY_HIDDEN) === '1';
  } catch {
    return false;
  }
}

export function writeWorkspaceSidebarRailHidden(hidden: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY_HIDDEN, hidden ? '1' : '0');
  } catch {
    /* ignore */
  }
}
