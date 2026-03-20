/**
 * Agent 完成通知协调器
 * - 整合桌面通知和提示音
 * - 根据设置选择内置音色或自定义音频文件
 */

import { BrowserNotifier } from './notification/browser-notification';
import { ElectronNotifier } from './notification/electron-notification';
import { AudioPlayer } from './audio/audio-player';
import {
  NOTIFICATION_CONFIG,
  AUDIO_CONFIG,
} from './notification/notification-config';
import { getNotificationSettings } from './notification-settings-client';
import { normalizeNotificationSettings } from './notification/notification-sound-presets';

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

  async notifyCompletion(params: CompletionNotifyParams): Promise<void> {
    try {
      const settings = normalizeNotificationSettings(await getNotificationSettings());
      console.debug('[CompletionNotifier] 设置已加载:', {
        enabled: settings.enabled,
        soundEnabled: settings.soundEnabled,
        soundVolume: settings.soundVolume,
        onlyWhenUnfocused: settings.onlyWhenUnfocused,
        soundSource: settings.soundSource,
        builtinSound: settings.builtinSound,
        hasCustomSound: !!settings.customSoundDataUrl,
      });

      if (!settings.enabled) {
        console.info('[CompletionNotifier] 通知已禁用，跳过');
        return;
      }

      if (settings.onlyWhenUnfocused && document.hasFocus?.()) {
        console.debug('[CompletionNotifier] 窗口已聚焦，跳过通知');
        return;
      }

      const now = Date.now();
      if (now - this.lastNotificationTime < 500) {
        console.debug('[CompletionNotifier] 去重：跳过快速连续通知');
        return;
      }
      this.lastNotificationTime = now;

      const notificationTitle = NOTIFICATION_CONFIG.MESSAGES.TITLE;
      const notificationBody =
        NOTIFICATION_CONFIG.MESSAGES.BODY_TEMPLATE.replace(
          '{agentName}',
          params.agentName,
        ).replace('{sessionTitle}', params.sessionTitle);

      const notificationTag = `${NOTIFICATION_CONFIG.TAG_PREFIX}-${params.sessionId}`;

      let notified = false;
      if (ElectronNotifier.isAvailable()) {
        notified = await this.electronNotifier.sendNotification({
          title: notificationTitle,
          body: notificationBody,
          icon: NOTIFICATION_CONFIG.DEFAULT_ICON,
          tag: notificationTag,
          sessionId: params.sessionId,
          onClick: params.navigateToSession,
        });
      } else {
        notified = await this.browserNotifier.sendNotification({
          title: notificationTitle,
          body: notificationBody,
          icon: NOTIFICATION_CONFIG.DEFAULT_ICON,
          tag: notificationTag,
          onClick: params.navigateToSession,
        });
      }
      console.debug('[CompletionNotifier] 通知发送结果:', notified);

      if (settings.soundEnabled) {
        try {
          await this.audioPlayer.playSound(
            {
              soundSource: settings.soundSource,
              builtinSound: settings.builtinSound,
              customSoundDataUrl: settings.customSoundDataUrl,
            },
            {
              volume: settings.soundVolume || AUDIO_CONFIG.DEFAULT_VOLUME,
              maxRetries: AUDIO_CONFIG.MAX_RETRIES,
            },
          );
        } catch (audioErr) {
          console.warn('[CompletionNotifier] 音频播放失败:', audioErr);
        }
      }
    } catch (error) {
      console.error('[CompletionNotifier] 通知流程错误:', error);
    }
  }

  async preloadSound(): Promise<void> {
    try {
      const settings = normalizeNotificationSettings(await getNotificationSettings());
      await this.audioPlayer.preload({
        soundSource: settings.soundSource,
        builtinSound: settings.builtinSound,
        customSoundDataUrl: settings.customSoundDataUrl,
      });
    } catch (error) {
      console.warn('[CompletionNotifier] 音频预加载失败:', error);
    }
  }

  cleanup(): void {
    this.audioPlayer.cleanup();
  }
}

export const completionNotifier = new CompletionNotifier();
