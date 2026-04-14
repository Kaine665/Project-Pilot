/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Electron preload（electron/preload.ts）注入 */
interface Window {
  electron?: {
    openFolderDialog: () => Promise<string | null>;
    getPathForFile: (file: File) => string;
    openFile: (path: string) => Promise<unknown>;
    openExternalUrl: (url: string) => Promise<{ ok?: true; error?: string }>;
    focusMainWindow?: () => Promise<void>;
    /** Win/Linux：与主进程 `titleBarOverlay.height` 一致；缺省表示使用系统默认标题栏 */
    titleBarOverlay?: { height: number };
  };
}
