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
  requireInteraction?: boolean;
  focusAppOnClick?: boolean;
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
        requireInteraction?: boolean;
        focusAppOnClick?: boolean;
      }) => Promise<boolean>;
      /**
       * Phase 3: 监听通知点击事件
       */
      onNotificationClicked?: (
        callback: (data: { sessionId?: string; timestamp: number }) => void
      ) => (() => void);
    };
  }
}

export class ElectronNotifier {
  private clickHandlers = new Map<string, () => void>();
  private removeClickListener: (() => void) | null = null;

  /**
   * 检查 Electron IPC 是否可用
   */
  static isAvailable(): boolean {
    return (
      typeof window !== 'undefined' &&
      !!window.electronAPI?.showNotification
    );
  }

  private ensureClickListener(): void {
    if (this.removeClickListener || !window.electronAPI?.onNotificationClicked) {
      return;
    }

    this.removeClickListener = window.electronAPI.onNotificationClicked((data) => {
      if (!data.sessionId) return;
      const handler = this.clickHandlers.get(data.sessionId);
      if (!handler) return;
      this.clickHandlers.delete(data.sessionId);
      handler();
    });
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
      if (options.sessionId && options.onClick && window.electronAPI?.onNotificationClicked) {
        this.ensureClickListener();
        this.clickHandlers.set(options.sessionId, options.onClick);
      }

      const result = await window.electronAPI!.showNotification({
        title: options.title,
        body: options.body,
        icon: options.icon,
        tag: options.tag,
        sessionId: options.sessionId,
        requireInteraction: options.requireInteraction,
        focusAppOnClick: options.focusAppOnClick,
      });
      if (!result && options.sessionId) {
        this.clickHandlers.delete(options.sessionId);
      }

      return result;
    } catch (error) {
      if (options.sessionId) {
        this.clickHandlers.delete(options.sessionId);
      }
      console.error('[ElectronNotifier] 发送通知失败:', error);
      return false;
    }
  }

  cleanup(): void {
    this.clickHandlers.clear();
    this.removeClickListener?.();
    this.removeClickListener = null;
  }
}
