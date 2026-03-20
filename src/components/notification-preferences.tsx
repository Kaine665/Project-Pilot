'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Music, Upload, Volume2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { completionNotifier } from '@/lib/completion-notifier';
import {
  BUILT_IN_NOTIFICATION_SOUND_OPTIONS,
  MAX_CUSTOM_SOUND_BYTES,
  NOTIFICATION_SOUND_SOURCE_OPTIONS,
  normalizeNotificationSettings,
} from '@/lib/notification/notification-sound-presets';
import {
  getNotificationSettings,
  updateNotificationSettings,
} from '@/lib/notification-settings-client';
import type { NotificationSettings } from '@/types';

export function NotificationPreferences() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [testInProgress, setTestInProgress] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    getNotificationSettings()
      .then((value) => setSettings(normalizeNotificationSettings(value)))
      .catch((error) => {
        console.error('加载通知设置失败:', error);
      });
  }, []);

  const handleSettingChange = useCallback(
    async (updates: Partial<NotificationSettings>) => {
      if (!settings) return;

      setIsSaving(true);
      setStatusText(null);
      try {
        const nextSettings = normalizeNotificationSettings({
          ...settings,
          ...updates,
        });

        await updateNotificationSettings(nextSettings);
        setSettings(nextSettings);
        await completionNotifier.preloadSound();
      } catch (error) {
        console.error('保存通知设置失败:', error);
        setStatusText('保存失败，请重试');
      } finally {
        setIsSaving(false);
      }
    },
    [settings],
  );

  const handleTestNotification = useCallback(async () => {
    if (testInProgress) return;

    setTestInProgress(true);
    setStatusText(null);
    try {
      await completionNotifier.notifyCompletion({
        agentName: 'Test Agent',
        sessionId: 'test-session',
        sessionTitle: '测试会话',
      });
    } catch (error) {
      console.error('测试通知失败:', error);
      setStatusText('测试通知失败，请检查浏览器权限');
    } finally {
      setTestInProgress(false);
    }
  }, [testInProgress]);

  const handleCustomSoundPick = useCallback(async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('audio/')) {
      setStatusText('请选择音频文件');
      return;
    }

    if (file.size > MAX_CUSTOM_SOUND_BYTES) {
      setStatusText('自定义提示音请控制在 512KB 以内');
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      await handleSettingChange({
        soundSource: 'custom',
        customSoundDataUrl: dataUrl,
        customSoundName: file.name,
      });
      setStatusText(`已保存自定义音频：${file.name}`);
    } catch (error) {
      console.error('读取自定义音频失败:', error);
      setStatusText('读取音频失败，请重试');
    }
  }, [handleSettingChange]);

  const handleClearCustomSound = useCallback(async () => {
    await handleSettingChange({
      soundSource: 'builtin',
      customSoundDataUrl: undefined,
      customSoundName: undefined,
    });
    setStatusText('已移除自定义音频，切回内置音色');
  }, [handleSettingChange]);

  if (!settings) {
    return <div className="text-sm text-gray-500">加载中...</div>;
  }

  const notificationsEnabled = settings.enabled ?? true;
  const soundEnabled = settings.soundEnabled ?? true;
  const usingCustomSound = settings.soundSource === 'custom';

  return (
    <section className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Bell className="w-4 h-4" />
        通知和音频
      </h3>

      <div className="space-y-3">
        <div className="flex items-center justify-between py-2">
          <label className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <input
              type="checkbox"
              checked={notificationsEnabled}
              onChange={(e) => handleSettingChange({ enabled: e.target.checked })}
              disabled={isSaving}
              className="rounded border-gray-300"
            />
            启用桌面通知
          </label>
        </div>

        <div className="flex items-center justify-between py-2">
          <label className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={(e) => handleSettingChange({ soundEnabled: e.target.checked })}
              disabled={isSaving || !notificationsEnabled}
              className="rounded border-gray-300"
            />
            <Music className="w-4 h-4" />
            启用通知音频
          </label>
        </div>

        {notificationsEnabled && soundEnabled && (
          <>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                  音频来源
                </label>
                <select
                  value={settings.soundSource ?? 'builtin'}
                  onChange={(e) => {
                    const soundSource = e.target.value as NotificationSettings['soundSource'];
                    void handleSettingChange({
                      soundSource,
                      ...(soundSource === 'builtin' && {
                        builtinSound: settings.builtinSound ?? 'classic',
                      }),
                    });
                  }}
                  disabled={isSaving}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                >
                  {NOTIFICATION_SOUND_SOURCE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {
                    NOTIFICATION_SOUND_SOURCE_OPTIONS.find(
                      (option) => option.id === settings.soundSource,
                    )?.description
                  }
                </p>
              </div>

              {!usingCustomSound && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                    内置音色
                  </label>
                  <select
                    value={settings.builtinSound ?? 'classic'}
                    onChange={(e) => {
                      void handleSettingChange({
                        builtinSound: e.target.value as NotificationSettings['builtinSound'],
                      });
                    }}
                    disabled={isSaving}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                  >
                    {BUILT_IN_NOTIFICATION_SOUND_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {
                      BUILT_IN_NOTIFICATION_SOUND_OPTIONS.find(
                        (option) => option.id === settings.builtinSound,
                      )?.description
                    }
                  </p>
                </div>
              )}

              {usingCustomSound && (
                <div className="space-y-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*"
                    onChange={(event) => void handleCustomSoundPick(event)}
                    className="hidden"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isSaving}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="mr-1 h-4 w-4" />
                      {settings.customSoundName ? '更换音频文件' : '选择音频文件'}
                    </Button>
                    {settings.customSoundName && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isSaving}
                        onClick={() => void handleClearCustomSound()}
                      >
                        <X className="mr-1 h-4 w-4" />
                        移除
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {settings.customSoundName
                      ? `当前文件：${settings.customSoundName}`
                      : '支持上传一段短音频，建议控制在 512KB 以内。'}
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 py-2">
              <label className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2 min-w-fit">
                <Volume2 className="w-4 h-4" />
                音量
              </label>
              <input
                type="range"
                min="0"
                max="100"
                step="10"
                value={(settings.soundVolume ?? 0.5) * 100}
                onChange={(e) =>
                  handleSettingChange({
                    soundVolume: parseInt(e.target.value, 10) / 100,
                  })}
                disabled={isSaving}
                className="flex-1 h-2 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-xs text-gray-500 dark:text-gray-400 min-w-fit">
                {Math.round((settings.soundVolume ?? 0.5) * 100)}%
              </span>
            </div>
          </>
        )}

        <div className="flex items-center justify-between py-2">
          <label className="text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={settings.onlyWhenUnfocused ?? false}
              onChange={(e) => handleSettingChange({ onlyWhenUnfocused: e.target.checked })}
              disabled={isSaving || !notificationsEnabled}
              className="rounded border-gray-300"
            />
            {' '}
            仅在窗口失焦时通知
          </label>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            防止正在查看时重复打扰
          </span>
        </div>

        <div className="pt-2">
          <Button
            onClick={handleTestNotification}
            disabled={isSaving || testInProgress || !notificationsEnabled}
            variant="outline"
            size="sm"
            className="w-full"
          >
            {testInProgress ? '测试中...' : '测试通知'}
          </Button>
        </div>

        {statusText && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {statusText}
          </p>
        )}
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
        Agent 回复完成后会发送桌面通知，并按当前配置播放内置音色或自定义提示音。
      </p>
    </section>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('FileReader result is not a string'));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
