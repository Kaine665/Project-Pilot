/** 与 `electron/main.ts` 中 `TITLE_BAR_OVERLAY_PX`、preload 暴露的 `titleBarOverlay.height` 保持一致 */
export const TITLE_BAR_OVERLAY_HEIGHT_PX = 36;

export const PP_ELECTRON_TITLEBAR_CSS_VAR = '--pp-electron-titlebar-inset';

/** 与 `TopNav` 占位一致（`top-14` = 3.5rem）；供 shell 根计算 `--pp-workspace-fixed-*` */
export const PP_WORKSPACE_TOP_NAV_STACK = '3.5rem';

/**
 * 由 `WorkspaceShell` / `layout` 根节点设置 `--pp-workspace-fixed-top` / `--pp-workspace-fixed-height` 后使用。
 * （原写死 `3.5rem + titleBar` 已改为变量，以支持 Agents 简单浏览器「工作区沉浸」仅保留 Electron 标题条。）
 */
export const PP_WORKSPACE_FIXED_TOP_CLASS = 'top-[var(--pp-workspace-fixed-top)]';

export const PP_WORKSPACE_FIXED_HEIGHT_CLASS = 'h-[var(--pp-workspace-fixed-height)]';

/** @deprecated 使用 {@link PP_WORKSPACE_FIXED_TOP_CLASS}，并保证 shell 设置 CSS 变量 */
export const PP_ELECTRON_WORKSPACE_FIXED_TOP_CLASS = PP_WORKSPACE_FIXED_TOP_CLASS;

/** @deprecated 使用 {@link PP_WORKSPACE_FIXED_HEIGHT_CLASS} */
export const PP_ELECTRON_WORKSPACE_FIXED_HEIGHT_CLASS = PP_WORKSPACE_FIXED_HEIGHT_CLASS;

export function readElectronTitleBarInsetPx(): number {
  if (typeof window === 'undefined') return 0;

  // 优先：preload 注入的 window.electron
  const h = window.electron?.titleBarOverlay?.height;
  if (typeof h === 'number' && h > 0) return h;

  const wco = (navigator as any).windowControlsOverlay;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isElectron = /Electron\//i.test(ua);

  /**
   * Electron 下 preload 可能未注入，但 WCO 仍生效。部分 Chromium 会把「叠层 + TopNav 首行」等一起算进
   * `getTitlebarAreaRect().height`（例如 ≈104px），壳层 `paddingTop` 会多出一大块空白；与主进程固定 TITLE_BAR 高度对齐。
   */
  if (isElectron && wco?.visible) {
    return TITLE_BAR_OVERLAY_HEIGHT_PX;
  }

  // 其它环境（含 PWA WCO）：按 API 返回
  if (wco?.visible) {
    const rect = wco.getTitlebarAreaRect?.();
    if (rect && rect.height > 0) return Math.round(rect.height);
  }

  return 0;
}
