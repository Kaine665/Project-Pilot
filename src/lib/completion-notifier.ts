/**
 * Agent completion notification coordinator.
 * Combines native/browser notifications with configurable local audio playback.
 */

import type { NotificationClickAction, NotificationSettings } from '@/types';
import { BrowserNotifier } from './notification/browser-notification';
import { ElectronNotifier } from './notification/electron-notification';
import { AudioPlayer } from './audio/audio-player';
import { NOTIFICATION_CONFIG, AUDIO_CONFIG } from './notification/notification-config';
import { getNotificationSettings } from './notification-settings-client';
import { normalizeNotificationSettings } from './notification/notification-sound-presets';

export interface CompletionNotifyParams {
  agentName: string;
  sessionId: string;
  sessionTitle: string;
  messagePreview?: string;
  durationMs?: number;
  navigateToSession?: () => void;
}

function sanitizePreview(value?: string): string {
  if (!value) return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= NOTIFICATION_CONFIG.MAX_PREVIEW_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, NOTIFICATION_CONFIG.MAX_PREVIEW_LENGTH - 1)}…`;
}

function formatTemplate(template: string, params: CompletionNotifyParams): string {
  const durationSec = typeof params.durationMs === 'number'
    ? Math.max(0, Math.round(params.durationMs / 1000))
    : 0;

  return template
    .replaceAll('{agentName}', params.agentName)
    .replaceAll('{sessionTitle}', params.sessionTitle)
    .replaceAll('{messagePreview}', sanitizePreview(params.messagePreview))
    .replaceAll('{durationSec}', String(durationSec))
    .trim();
}

function getClickBehavior(
  settings: NotificationSettings,
  params: CompletionNotifyParams,
): {
  clickAction: NotificationClickAction;
  focusAppOnClick: boolean;
  sessionId?: string;
  onClick?: () => void;
} {
  const clickAction = settings.clickAction ?? 'open_session';

  if (clickAction === 'open_session') {
    return {
      clickAction,
      focusAppOnClick: true,
      sessionId: params.sessionId,
      onClick: params.navigateToSession,
    };
  }

  if (clickAction === 'focus_app') {
    return {
      clickAction,
      focusAppOnClick: true,
    };
  }

  return {
    clickAction,
    focusAppOnClick: false,
  };
}

export class CompletionNotifier {
  private browserNotifier = new BrowserNotifier();
  private electronNotifier = new ElectronNotifier();
  private audioPlayer = new AudioPlayer();
  private lastNotificationAtBySession = new Map<string, number>();

  async notifyCompletion(params: CompletionNotifyParams): Promise<void> {
    try {
      const settings = normalizeNotificationSettings(await getNotificationSettings());
      if (!settings.enabled) {
        return;
      }

      if (settings.onlyWhenUnfocused && document.hasFocus?.()) {
        return;
      }

      const durationMs = params.durationMs ?? 0;
      const minDurationMs = settings.minDurationMs ?? 0;
      if (durationMs < minDurationMs) {
        return;
      }

      const dedupeWindowMs = settings.dedupeWindowMs ?? 500;
      const now = Date.now();
      const lastNotificationAt = this.lastNotificationAtBySession.get(params.sessionId) ?? 0;
      if (now - lastNotificationAt < dedupeWindowMs) {
        return;
      }
      this.lastNotificationAtBySession.set(params.sessionId, now);

      const titleTemplate = settings.titleTemplate ?? '{agentName} 已完成';
      const bodyTemplate = settings.bodyTemplate ?? '会话“{sessionTitle}”已收到新回复';
      const notificationTitle = formatTemplate(titleTemplate, params);
      const notificationBody = formatTemplate(bodyTemplate, params);
      const notificationTag = `${NOTIFICATION_CONFIG.TAG_PREFIX}-${params.sessionId}`;
      const clickBehavior = getClickBehavior(settings, params);

      if (ElectronNotifier.isAvailable()) {
        await this.electronNotifier.sendNotification({
          title: notificationTitle,
          body: notificationBody,
          icon: NOTIFICATION_CONFIG.DEFAULT_ICON,
          tag: notificationTag,
          sessionId: clickBehavior.sessionId,
          requireInteraction: settings.requireInteraction ?? true,
          focusAppOnClick: clickBehavior.focusAppOnClick,
          onClick: clickBehavior.onClick,
        });
      } else {
        await this.browserNotifier.sendNotification({
          title: notificationTitle,
          body: notificationBody,
          icon: NOTIFICATION_CONFIG.DEFAULT_ICON,
          tag: notificationTag,
          onClick: clickBehavior.clickAction === 'open_session'
            ? params.navigateToSession
            : undefined,
        });
      }

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
          console.warn('[CompletionNotifier] Failed to play notification sound:', audioErr);
        }
      }
    } catch (error) {
      console.error('[CompletionNotifier] Notification flow failed:', error);
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
      console.warn('[CompletionNotifier] Failed to preload sound:', error);
    }
  }

  cleanup(): void {
    this.lastNotificationAtBySession.clear();
    this.audioPlayer.cleanup();
    this.electronNotifier.cleanup();
  }
}

export const completionNotifier = new CompletionNotifier();
