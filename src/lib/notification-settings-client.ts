/**
 * 通知设置客户端 API
 *
 * 供浏览器/客户端组件使用，通过 fetch 调用 /api/settings，
 * 避免导入 file-store（依赖 Node.js fs，无法在浏览器中运行）。
 *
 * 服务端代码应继续使用 settings-manager 的 getNotificationSettings/updateNotificationSettings。
 */

import type { NotificationSettings } from '@/types';
import { DEFAULT_NOTIFICATION_SETTINGS } from '@/types';
import { normalizeNotificationSettings } from './notification/notification-sound-presets';

/**
 * 从 API 获取通知设置（客户端专用）
 */
export async function getNotificationSettings(): Promise<NotificationSettings> {
  const res = await fetch('/api/settings', { cache: 'no-store' });
  if (!res.ok) {
    return normalizeNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS);
  }
  const data = await res.json();
  return normalizeNotificationSettings(data.notifications ?? DEFAULT_NOTIFICATION_SETTINGS);
}

/**
 * 更新通知设置（客户端专用）
 * 通过 API 合并更新并持久化
 */
export async function updateNotificationSettings(
  updates: Partial<NotificationSettings>,
): Promise<void> {
  const current = await getNotificationSettings();
  const merged: NotificationSettings = normalizeNotificationSettings({
    ...current,
    ...updates,
  });

  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      notifications: {
        ...merged,
        ...(merged.customSoundDataUrl === undefined ? { customSoundDataUrl: null } : {}),
        ...(merged.customSoundName === undefined ? { customSoundName: null } : {}),
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
}
