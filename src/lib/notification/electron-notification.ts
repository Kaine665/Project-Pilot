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
  sessionId?: string;
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
        sessionId?: string;
      }) => Promise<boolean>;
      /**
       * Phase 3: 监听通知点击事件
       */
      onNotificationClicked?: (
        callback: (data: { sessionId?: string; timestamp: number }) => void
      ) => void;
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
   * Phase 3: 支持会话 ID，允许点击后导航到对应会话
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
        sessionId: options.sessionId,
      });

      // Phase 3: 设置通知点击监听
      if (result && options.onClick && window.electronAPI?.onNotificationClicked) {
        window.electronAPI.onNotificationClicked((data) => {
          console.debug('[ElectronNotifier] 用户点击了通知:', data);
          options.onClick?.();
        });
      }

      return result;
    } catch (error) {
      console.error('[ElectronNotifier] 发送通知失败:', error);
      return false;
    }
  }
}
