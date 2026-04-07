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
  };
}
