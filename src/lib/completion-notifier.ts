/**
 * Agent 完成通知协调器
 * - 整合通知 + 音频
 * - 环境检测（浏览器 vs Electron）
 * - 设置读取和应用
 */

import { BrowserNotifier } from './notification/browser-notification';
import { ElectronNotifier } from './notification/electron-notification';
import { AudioPlayer } from './audio/audio-player';
import {
  NOTIFICATION_CONFIG,
  AUDIO_CONFIG,
} from './notification/notification-config';
import { getNotificationSettings } from './settings-manager';

export interface CompletionNotifyParams {
  agentName: string;
  sessionId: string;
  sessionTitle: string;
  navigateToSession?: () => void;
}

export class CompletionNotifier {
  private browserNotifier = new BrowserNotifier();
  private electronNotifier = new ElectronNotifier();
  private audioPlayer = new AudioPlayer();
  private lastNotificationTime = 0;

  /**
   * 发送完成通知（包括桌面提示和音频）
   */
  async notifyCompletion(params: CompletionNotifyParams): Promise<void> {
    try {
      // 1. 读取用户设置
      const settings = await getNotificationSettings();

      // 如果通知被禁用，直接返回
      if (!settings.enabled) {
        console.debug('[CompletionNotifier] 通知已禁用');
        return;
      }

      // 2. 检查窗口聚焦状态
      if (settings.onlyWhenUnfocused && document.hasFocus?.()) {
        console.debug('[CompletionNotifier] 窗口已聚焦，跳过通知');
        return;
      }

      // 3. 去重检查：避免快速连续通知
      const now = Date.now();
      if (now - this.lastNotificationTime < 500) {
        console.debug('[CompletionNotifier] 去重：跳过快速连续通知');
        return;
      }
      this.lastNotificationTime = now;

      // 4. 构建通知内容
      const notificationTitle = NOTIFICATION_CONFIG.MESSAGES.TITLE;
      const notificationBody =
        NOTIFICATION_CONFIG.MESSAGES.BODY_TEMPLATE.replace(
          '{agentName}',
          params.agentName
        ).replace('{sessionTitle}', params.sessionTitle);

      const notificationTag = `${NOTIFICATION_CONFIG.TAG_PREFIX}-${params.sessionId}`;

      // 5. 优先选择 Electron，降级到浏览器
      let notified = false;

      if (ElectronNotifier.isAvailable()) {
        console.debug('[CompletionNotifier] 使用 Electron 原生通知');
        notified = await this.electronNotifier.sendNotification({
          title: notificationTitle,
          body: notificationBody,
          icon: NOTIFICATION_CONFIG.DEFAULT_ICON,
          tag: notificationTag,
        });
      } else {
        console.debug('[CompletionNotifier] 使用 Web Notifications API');
        notified = await this.browserNotifier.sendNotification({
          title: notificationTitle,
          body: notificationBody,
          icon: NOTIFICATION_CONFIG.DEFAULT_ICON,
          tag: notificationTag,
          onClick: params.navigateToSession,
        });
      }

      // 6. 播放音频
      if (settings.soundEnabled && notified) {
        console.debug('[CompletionNotifier] 播放通知音频');
        await this.audioPlayer.playSound(AUDIO_CONFIG.DEFAULT_SOUND_PATH, {
          volume: settings.soundVolume || AUDIO_CONFIG.DEFAULT_VOLUME,
          maxRetries: AUDIO_CONFIG.MAX_RETRIES,
        });
      }
    } catch (error) {
      console.error('[CompletionNotifier] 通知失败:', error);
    }
  }

  /**
   * 预加载音频文件（用于初始化）
   */
  async preloadSound(): Promise<void> {
    try {
      await this.audioPlayer.preload(AUDIO_CONFIG.DEFAULT_SOUND_PATH);
    } catch (error) {
      console.warn('[CompletionNotifier] 音频预加载失败:', error);
    }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.audioPlayer.cleanup();
  }
}

// 导出单例实例
export const completionNotifier = new CompletionNotifier();
