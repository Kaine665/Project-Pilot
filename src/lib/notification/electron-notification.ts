/**
 * Electron 原生通知适配器
 * - 调用 electron.ipcRenderer 与主进程通信
 * - 无需权限，直接显示系统通知
 */

export interface NotificationOptions {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  onClick?: () => void;
}

declare global {
  interface Window {
    electronAPI?: {
      showNotification: (options: {
        title: string;
        body: string;
        icon?: string;
        tag?: string;
      }) => Promise<boolean>;
    };
  }
}

export class ElectronNotifier {
  /**
   * 检查 Electron IPC 是否可用
   */
  static isAvailable(): boolean {
    return (
      typeof window !== 'undefined' &&
      !!(window as any).electronAPI?.showNotification
    );
  }

  /**
   * 发送 Electron 原生通知
   */
  async sendNotification(options: NotificationOptions): Promise<boolean> {
    if (!ElectronNotifier.isAvailable()) {
      console.debug('[ElectronNotifier] Electron API 不可用');
      return false;
    }

    try {
      const result = await window.electronAPI!.showNotification({
        title: options.title,
        body: options.body,
        icon: options.icon,
        tag: options.tag,
      });

      return result;
    } catch (error) {
      console.error('[ElectronNotifier] 发送通知失败:', error);
      return false;
    }
  }
}
