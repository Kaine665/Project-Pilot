'use client';

/**
 * 通知和音频偏好设置面板
 * - 启用/禁用桌面通知
 * - 启用/禁用音频
 * - 音量调节
 * - 失焦通知选项
 * - 测试按钮
 */

import { useCallback, useEffect, useState } from 'react';
import { Volume2, Bell, Music } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  getNotificationSettings,
  updateNotificationSettings,
} from '@/lib/settings-manager';
import { completionNotifier } from '@/lib/completion-notifier';
import type { NotificationSettings } from '@/types';

export function NotificationPreferences() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [testInProgress, setTestInProgress] = useState(false);

  // 初始化设置
  useEffect(() => {
    getNotificationSettings().then(setSettings);
  }, []);

  // 保存设置
  const handleSettingChange = useCallback(
    async (updates: Partial<NotificationSettings>) => {
      if (!settings) return;

      setIsSaving(true);
      try {
        const newSettings = { ...settings, ...updates };
        await updateNotificationSettings(updates);
        setSettings(newSettings);
      } catch (error) {
        console.error('保存设置失败:', error);
      } finally {
        setIsSaving(false);
      }
    },
    [settings]
  );

  // 测试通知
  const handleTestNotification = useCallback(async () => {
    if (testInProgress) return;

    setTestInProgress(true);
    try {
      await completionNotifier.notifyCompletion({
        agentName: 'Test Agent',
        sessionId: 'test-session',
        sessionTitle: '测试会话',
      });
    } catch (error) {
      console.error('测试通知失败:', error);
    } finally {
      setTestInProgress(false);
    }
  }, [testInProgress]);

  if (!settings) {
    return <div className="text-sm text-gray-500">加载中...</div>;
  }

  return (
    <section className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Bell className="w-4 h-4" />
        通知和音频
      </h3>

      <div className="space-y-3">
        {/* 启用/禁用桌面通知 */}
        <div className="flex items-center justify-between py-2">
          <label className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.enabled ?? true}
              onChange={(e) =>
                handleSettingChange({ enabled: e.target.checked })
              }
              disabled={isSaving}
              className="rounded border-gray-300"
            />
            启用桌面通知
          </label>
        </div>

        {/* 启用/禁用音频 */}
        <div className="flex items-center justify-between py-2">
          <label className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.soundEnabled ?? true}
              onChange={(e) =>
                handleSettingChange({ soundEnabled: e.target.checked })
              }
              disabled={isSaving || !(settings.enabled ?? true)}
              className="rounded border-gray-300"
            />
            <Music className="w-4 h-4" />
            启用通知音频
          </label>
        </div>

        {/* 音量滑块 */}
        {(settings.soundEnabled ?? true) && (settings.enabled ?? true) && (
          <div className="flex items-center gap-3 py-2">
            <label className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2 min-w-fit">
              <Volume2 className="w-4 h-4" />
              音量：
            </label>
            <input
              type="range"
              min="0"
              max="100"
              step="10"
              value={(settings.soundVolume ?? 0.5) * 100}
              onChange={(e) =>
                handleSettingChange({
                  soundVolume: parseInt(e.target.value) / 100,
                })
              }
              disabled={isSaving}
              className="flex-1 h-2 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400 min-w-fit">
              {Math.round((settings.soundVolume ?? 0.5) * 100)}%
            </span>
          </div>
        )}

        {/* 仅失焦时通知 */}
        <div className="flex items-center justify-between py-2">
          <label className="text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={settings.onlyWhenUnfocused ?? false}
              onChange={(e) =>
                handleSettingChange({ onlyWhenUnfocused: e.target.checked })
              }
              disabled={isSaving || !(settings.enabled ?? true)}
              className="rounded border-gray-300"
            />
            {' '}
            仅在窗口失焦时通知
          </label>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            防止已可见时重复提醒
          </span>
        </div>

        {/* 测试按钮 */}
        <div className="pt-2">
          <Button
            onClick={handleTestNotification}
            disabled={isSaving || testInProgress || !(settings.enabled ?? true)}
            variant="secondary"
            size="sm"
            className="w-full"
          >
            {testInProgress ? '测试中...' : '测试通知'}
          </Button>
        </div>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
        💡 当 Agent 完成回复时，会在 Windows 右下角显示桌面通知并播放提示音。
      </p>
    </section>
  );
}
