/**
 * Electron IPC TypeScript 定义
 */

declare global {
  interface Window {
    electronAPI?: {
      /**
       * 显示系统通知
       * @param options 通知选项
       * @returns 是否成功
       */
      showNotification: (options: {
        title: string;
        body: string;
        icon?: string;
        tag?: string;
      }) => Promise<boolean>;
    };
  }
}

export {};
