'use client';

/**
 * Notification and audio preferences.
 */

import { useCallback, useEffect, useState } from 'react';
import { Bell, MousePointerClick, Music, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  getNotificationSettings,
  updateNotificationSettings,
} from '@/lib/notification-settings-client';
import { completionNotifier } from '@/lib/completion-notifier';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationClickAction,
  type NotificationSettings,
} from '@/types';

const CLICK_ACTION_OPTIONS: Array<{
  value: NotificationClickAction;
  label: string;
  help: string;
}> = [
  { value: 'open_session', label: '打开对应会话', help: '点击通知后聚焦应用并跳转到本次回复所在会话。' },
  { value: 'focus_app', label: '只聚焦应用', help: '点击通知后只回到 ProjectPilot，不自动跳转会话。' },
  { value: 'none', label: '不处理点击', help: '保留系统通知，但点击后不执行应用内动作。' },
];

function parseNonNegativeInt(value: string, fallback: number): number {
  const next = Number.parseInt(value, 10);
  return Number.isFinite(next) && next >= 0 ? next : fallback;
}

export function NotificationPreferences() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [testInProgress, setTestInProgress] = useState(false);
  const [titleTemplateDraft, setTitleTemplateDraft] = useState('');
  const [bodyTemplateDraft, setBodyTemplateDraft] = useState('');
  const [minDurationDraft, setMinDurationDraft] = useState('0');
  const [dedupeWindowDraft, setDedupeWindowDraft] = useState('500');

  useEffect(() => {
    getNotificationSettings().then(setSettings);
  }, []);

  useEffect(() => {
    if (!settings) return;
    setTitleTemplateDraft(
      settings.titleTemplate ?? DEFAULT_NOTIFICATION_SETTINGS.titleTemplate ?? ''
    );
    setBodyTemplateDraft(
      settings.bodyTemplate ?? DEFAULT_NOTIFICATION_SETTINGS.bodyTemplate ?? ''
    );
    setMinDurationDraft(String(settings.minDurationMs ?? DEFAULT_NOTIFICATION_SETTINGS.minDurationMs ?? 0));
    setDedupeWindowDraft(String(settings.dedupeWindowMs ?? DEFAULT_NOTIFICATION_SETTINGS.dedupeWindowMs ?? 500));
  }, [settings]);

  const handleSettingChange = useCallback(
    async (updates: Partial<NotificationSettings>) => {
      if (!settings) return;

      setIsSaving(true);
      try {
        const newSettings = { ...settings, ...updates };
        await updateNotificationSettings(updates);
        setSettings(newSettings);
      } catch (error) {
        console.error('保存通知设置失败:', error);
      } finally {
        setIsSaving(false);
      }
    },
    [settings]
  );

  const commitTemplateField = useCallback(
    (key: 'titleTemplate' | 'bodyTemplate', value: string) => {
      const fallback = DEFAULT_NOTIFICATION_SETTINGS[key] ?? '';
      const normalized = value.trim() || fallback;
      if (key === 'titleTemplate') {
        setTitleTemplateDraft(normalized);
      } else {
        setBodyTemplateDraft(normalized);
      }
      void handleSettingChange({ [key]: normalized });
    },
    [handleSettingChange]
  );

  const commitNumberField = useCallback(
    (key: 'minDurationMs' | 'dedupeWindowMs', value: string) => {
      const fallback = DEFAULT_NOTIFICATION_SETTINGS[key] ?? 0;
      const normalized = parseNonNegativeInt(value, fallback);
      if (key === 'minDurationMs') {
        setMinDurationDraft(String(normalized));
      } else {
        setDedupeWindowDraft(String(normalized));
      }
      void handleSettingChange({ [key]: normalized });
    },
    [handleSettingChange]
  );

  const handleTestNotification = useCallback(async () => {
    if (testInProgress) return;

    setTestInProgress(true);
    try {
      await completionNotifier.notifyCompletion({
        agentName: 'Test Agent',
        sessionId: 'test-session',
        sessionTitle: '通知配置测试',
        messagePreview: '这是测试通知的回复预览内容，用来确认模板变量和点击行为是否正常。',
        durationMs: 12_000,
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

  const notificationsEnabled = settings.enabled ?? true;
  const soundEnabled = settings.soundEnabled ?? true;
  const clickAction = settings.clickAction ?? DEFAULT_NOTIFICATION_SETTINGS.clickAction ?? 'open_session';

  return (
    <section className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Bell className="h-4 w-4" />
        通知和音频
      </h3>

      <div className="space-y-4">
        <div className="flex items-center justify-between py-1">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={notificationsEnabled}
              onChange={(e) => {
                void handleSettingChange({ enabled: e.target.checked });
              }}
              disabled={isSaving}
              className="rounded border-gray-300"
            />
            启用桌面通知
          </label>
        </div>

        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
            <Bell className="h-4 w-4" />
            通知内容
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                标题模板
              </label>
              <Input
                value={titleTemplateDraft}
                onChange={(e) => setTitleTemplateDraft(e.target.value)}
                onBlur={() => commitTemplateField('titleTemplate', titleTemplateDraft)}
                disabled={isSaving || !notificationsEnabled}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                正文模板
              </label>
              <textarea
                value={bodyTemplateDraft}
                onChange={(e) => setBodyTemplateDraft(e.target.value)}
                onBlur={() => commitTemplateField('bodyTemplate', bodyTemplateDraft)}
                disabled={isSaving || !notificationsEnabled}
                rows={3}
                className="flex w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:placeholder:text-zinc-500"
              />
            </div>

            <div className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-zinc-900/60 dark:text-gray-400">
              可用变量：<code>{'{agentName}'}</code> <code>{'{sessionTitle}'}</code>{' '}
              <code>{'{messagePreview}'}</code> <code>{'{durationSec}'}</code>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
            <MousePointerClick className="h-4 w-4" />
            通知行为
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4 py-1">
              <label className="text-sm text-gray-700 dark:text-gray-300">
                仅在窗口失焦时通知
              </label>
              <input
                type="checkbox"
                checked={settings.onlyWhenUnfocused ?? false}
                onChange={(e) => {
                  void handleSettingChange({ onlyWhenUnfocused: e.target.checked });
                }}
                disabled={isSaving || !notificationsEnabled}
                className="rounded border-gray-300"
              />
            </div>

            <div className="flex items-center justify-between gap-4 py-1">
              <label className="text-sm text-gray-700 dark:text-gray-300">
                保留在系统通知中心
              </label>
              <input
                type="checkbox"
                checked={settings.requireInteraction ?? true}
                onChange={(e) => {
                  void handleSettingChange({ requireInteraction: e.target.checked });
                }}
                disabled={isSaving || !notificationsEnabled}
                className="rounded border-gray-300"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                点击通知后的行为
              </label>
              <select
                value={clickAction}
                onChange={(e) => {
                  void handleSettingChange({
                    clickAction: e.target.value as NotificationClickAction,
                  });
                }}
                disabled={isSaving || !notificationsEnabled}
                className="flex h-9 w-full rounded-md border border-zinc-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700"
              >
                {CLICK_ACTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {CLICK_ACTION_OPTIONS.find((option) => option.value === clickAction)?.help}
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  最小时长（毫秒）
                </label>
                <Input
                  type="number"
                  min="0"
                  step="100"
                  value={minDurationDraft}
                  onChange={(e) => setMinDurationDraft(e.target.value)}
                  onBlur={() => commitNumberField('minDurationMs', minDurationDraft)}
                  disabled={isSaving || !notificationsEnabled}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  低于这个运行时长的回复不发送通知。
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  去重窗口（毫秒）
                </label>
                <Input
                  type="number"
                  min="0"
                  step="100"
                  value={dedupeWindowDraft}
                  onChange={(e) => setDedupeWindowDraft(e.target.value)}
                  onBlur={() => commitNumberField('dedupeWindowMs', dedupeWindowDraft)}
                  disabled={isSaving || !notificationsEnabled}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  同一会话在这个时间窗内只发一次原生通知。
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
            <Music className="h-4 w-4" />
            提示音
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between py-1">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={(e) => {
                    void handleSettingChange({ soundEnabled: e.target.checked });
                  }}
                  disabled={isSaving || !notificationsEnabled}
                  className="rounded border-gray-300"
                />
                <Music className="h-4 w-4" />
                启用通知音频
              </label>
            </div>

            {notificationsEnabled && soundEnabled && (
              <div className="flex items-center gap-3 py-1">
                <label className="flex min-w-fit items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <Volume2 className="h-4 w-4" />
                  音量
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="10"
                  value={(settings.soundVolume ?? 0.5) * 100}
                  onChange={(e) => {
                    void handleSettingChange({
                      soundVolume: Number.parseInt(e.target.value, 10) / 100,
                    });
                  }}
                  disabled={isSaving}
                  className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-600"
                />
                <span className="min-w-fit text-xs text-gray-500 dark:text-gray-400">
                  {Math.round((settings.soundVolume ?? 0.5) * 100)}%
                </span>
              </div>
            )}
          </div>
        </div>

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

      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        Electron 模式下会触发 Windows 或 macOS 原生通知；这里配置的是通知内容和点击行为，不改系统原生样式。
      </p>
    </section>
  );
}
