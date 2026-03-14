/**
 * Web Notifications API 封装
 * - 自动权限检测和请求
 * - 标签去重（同一会话不重复通知）
 * - 浏览器兼容性处理
 */

export interface NotificationOptions {
  title: string;
  body: string;
  icon?: string;
  tag?: string; // 用于去重，同一 tag 的新通知会替换旧通知
  onClick?: () => void;
}

export class BrowserNotifier {
  /**
   * 检查浏览器是否支持 Web Notifications API
   */
  static isSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  /**
   * 获取当前通知权限状态
   */
  static getPermission(): NotificationPermission | null {
    if (!this.isSupported()) return null;
    return Notification.permission;
  }

  /**
   * 发送通知
   * @returns 是否成功发送
   */
  async sendNotification(options: NotificationOptions): Promise<boolean> {
    // 1. 检查浏览器支持
    if (!BrowserNotifier.isSupported()) {
      console.warn('[BrowserNotifier] 浏览器不支持 Web Notifications API');
      return false;
    }

    // 2. 检查权限状态
    if (Notification.permission === 'denied') {
      console.debug('[BrowserNotifier] 用户已拒绝通知权限');
      return false;
    }

    // 3. 请求权限（如果需要）
    if (Notification.permission === 'default') {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          console.debug('[BrowserNotifier] 用户拒绝权限请求');
          return false;
        }
      } catch (error) {
        console.error('[BrowserNotifier] 权限请求失败:', error);
        return false;
      }
    }

    // 4. 发送通知
    try {
      const notification = new Notification(options.title, {
        tag: options.tag, // 同一 tag 的通知会替换（去重）
        body: options.body,
        icon: options.icon,
        requireInteraction: false, // 自动关闭
      });

      // 5. 点击处理
      notification.onclick = () => {
        window.focus();
        options.onClick?.();
        notification.close();
      };

      return true;
    } catch (error) {
      console.error('[BrowserNotifier] 发送通知失败:', error);
      return false;
    }
  }
}
